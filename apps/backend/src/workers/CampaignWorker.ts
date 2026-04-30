import Bull from 'bull'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { query, queryOne } from '../lib/db'
import { logger } from '../lib/logger'
import { baileysService } from '../services/BaileysService'
import { generateMessage, generateAudio, AIProvider } from '../services/AIService'
import { campaignWsEmitter } from '../lib/wsEmitter'

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
const TEMP_DIR = process.env.TEMP_DIR || '/app/data/temp'

interface Campaign {
  id: string
  name: string
  list_id: string
  ai_provider: AIProvider
  ai_model: string | null
  prompt: string
  media_type: 'none' | 'image' | 'audio'
  media_path: string | null
  min_delay: number
  max_delay: number
  max_per_day: number
  daily_sent: number
  last_send_date: string | null
  rotate_sessions: number
  session_ids: string
  sent: number
  failed: number
}

interface Contact {
  id: string
  phone: string
  jid: string | null
  name: string | null
}

export interface CampaignJob {
  campaignId: string
}

export let campaignQueue: Bull.Queue<CampaignJob>

export function initCampaignQueue(redisUrl: string) {
  campaignQueue = new Bull<CampaignJob>('campaign-queue', {
    redis: redisUrl,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  })

  campaignQueue.process(async (job) => {
    await processCampaign(job.data.campaignId)
  })

  campaignQueue.on('failed', async (job, err) => {
    logger.error({ err, jobId: job.id }, 'Job de campanha falhou')
    await query("UPDATE campaigns SET status = 'failed' WHERE id = ?", [job.data.campaignId])
    campaignWsEmitter.emit('campaign:update', {
      campaignId: job.data.campaignId,
      status: 'failed',
    })
  })

  logger.info('CampaignQueue inicializada')
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000
}

async function processCampaign(campaignId: string) {
  const campaign = await queryOne<Campaign>(
    'SELECT * FROM campaigns WHERE id = ?',
    [campaignId],
  )
  if (!campaign) throw new Error(`Campanha ${campaignId} não encontrada`)

  await query("UPDATE campaigns SET status = 'running' WHERE id = ?", [campaignId])
  campaignWsEmitter.emit('campaign:update', { campaignId, status: 'running' })

  const sessionIds: string[] = Array.isArray(campaign.session_ids)
    ? campaign.session_ids as unknown as string[]
    : JSON.parse(campaign.session_ids || '[]')
  const connectedSessions = sessionIds.filter((id) => baileysService.isConnected(id))

  if (connectedSessions.length === 0) {
    throw new Error('Nenhuma sessão WhatsApp conectada para esta campanha')
  }

  // Resume: pula contatos já enviados com sucesso ou marcados sem WhatsApp
  const contacts = await query<Contact>(
    `SELECT c.id, c.phone, c.jid, c.name
     FROM contacts c
     LEFT JOIN (
       SELECT contact_id, MAX(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS already_sent
       FROM campaign_logs WHERE campaign_id = ?
       GROUP BY contact_id
     ) cl ON cl.contact_id = c.id
     WHERE c.list_id = ?
       AND COALESCE(cl.already_sent, 0) = 0
       AND (c.wa_exists IS NULL OR c.wa_exists = 1)
     ORDER BY RAND()`,
    [campaignId, campaign.list_id],
  )

  let sessionIndex = 0
  let sent = campaign.sent || 0
  let failed = campaign.failed || 0

  const today = new Date().toISOString().slice(0, 10)
  let dailySent = campaign.last_send_date === today ? (campaign.daily_sent || 0) : 0
  if (campaign.last_send_date !== today) {
    await query(
      'UPDATE campaigns SET daily_sent = 0, last_send_date = ? WHERE id = ?',
      [today, campaignId],
    )
  }

  for (const contact of contacts) {
    const currentCampaign = await queryOne<{ status: string }>(
      'SELECT status FROM campaigns WHERE id = ?',
      [campaignId],
    )
    if (currentCampaign?.status === 'paused' || currentCampaign?.status === 'failed') {
      logger.info({ campaignId }, 'Campanha pausada ou cancelada')
      break
    }

    if (campaign.max_per_day > 0 && dailySent >= campaign.max_per_day) {
      await query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId])
      campaignWsEmitter.emit('campaign:update', {
        campaignId, status: 'paused', reason: 'max_per_day_reached',
      })
      logger.info({ campaignId, dailySent, max: campaign.max_per_day }, 'Limite diário atingido')
      break
    }

    const sessionId = connectedSessions[sessionIndex % connectedSessions.length]
    if (campaign.rotate_sessions) sessionIndex++

    const isLastContact = contact === contacts[contacts.length - 1]
    const delayMs = isLastContact ? 0 : randomDelay(campaign.min_delay, campaign.max_delay)

    const logId = uuidv4()
    await query(
      "INSERT INTO campaign_logs (id, campaign_id, contact_id, phone, status, session_id) VALUES (?, ?, ?, ?, 'pending', ?)",
      [logId, campaignId, contact.id, contact.phone, sessionId],
    )

    campaignWsEmitter.emit('campaign:sending', {
      campaignId,
      phone: contact.phone,
      name: contact.name,
      sessionId,
      aiProvider: campaign.ai_provider,
      aiModel: campaign.ai_model,
    })

    try {
      const message = await generateMessage(
        campaign.ai_provider,
        campaign.prompt,
        contact.name || '',
        contact.phone,
        campaign.ai_model || undefined,
      )

      const target = contact.jid || contact.phone

      if (campaign.media_type === 'none') {
        await baileysService.sendText(sessionId, target, message)
      } else if (campaign.media_type === 'image' && campaign.media_path) {
        const imagePath = path.join(UPLOADS_DIR, campaign.media_path)
        await baileysService.sendImage(sessionId, target, imagePath, message)
      } else if (campaign.media_type === 'audio') {
        const audioPath = path.join(TEMP_DIR, `${logId}.ogg`)
        fs.mkdirSync(TEMP_DIR, { recursive: true })
        await generateAudio(campaign.ai_provider, message, audioPath)

        if (campaign.media_path) {
          const imagePath = path.join(UPLOADS_DIR, campaign.media_path)
          await baileysService.sendImageWithAudio(
            sessionId,
            target,
            imagePath,
            audioPath,
            message,
          )
        } else {
          await baileysService.sendAudio(sessionId, target, audioPath)
        }

        fs.unlink(audioPath, () => null)
      }

      await query(
        "UPDATE campaign_logs SET status = 'sent', message = ?, sent_at = NOW() WHERE id = ?",
        [message, logId],
      )
      sent++
      dailySent++

      await query(
        'UPDATE campaigns SET sent = ?, daily_sent = ?, last_send_date = ? WHERE id = ?',
        [sent, dailySent, today, campaignId],
      )
      campaignWsEmitter.emit('campaign:progress', {
        campaignId,
        sent,
        failed,
        total: contacts.length,
        phone: contact.phone,
        name: contact.name,
        sessionId,
        aiProvider: campaign.ai_provider,
        aiModel: campaign.ai_model,
        message,
        delay: Math.round(delayMs / 1000),
        status: 'sent',
      })

      logger.info({ campaignId, phone: contact.phone, sessionId }, 'Mensagem enviada')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      await query(
        "UPDATE campaign_logs SET status = 'failed', error = ? WHERE id = ?",
        [errorMsg, logId],
      )
      failed++
      await query('UPDATE campaigns SET failed = ? WHERE id = ?', [failed, campaignId])
      campaignWsEmitter.emit('campaign:progress', {
        campaignId,
        sent,
        failed,
        total: contacts.length,
        phone: contact.phone,
        name: contact.name,
        sessionId,
        aiProvider: campaign.ai_provider,
        aiModel: campaign.ai_model,
        delay: Math.round(delayMs / 1000),
        status: 'failed',
        error: errorMsg,
      })
      logger.warn({ err, campaignId, phone: contact.phone }, 'Falha ao enviar mensagem')
    }

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  await query(
    "UPDATE campaigns SET status = 'completed', sent = ?, failed = ? WHERE id = ?",
    [sent, failed, campaignId],
  )
  campaignWsEmitter.emit('campaign:update', { campaignId, status: 'completed', sent, failed })
  logger.info({ campaignId, sent, failed }, 'Campanha concluída')
}
