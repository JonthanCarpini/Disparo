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
  rotate_sessions: number
  session_ids: string
}

interface Contact {
  id: string
  phone: string
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

  const sessionIds: string[] = JSON.parse(campaign.session_ids || '[]')
  const connectedSessions = sessionIds.filter((id) => baileysService.isConnected(id))

  if (connectedSessions.length === 0) {
    throw new Error('Nenhuma sessão WhatsApp conectada para esta campanha')
  }

  const contacts = await query<Contact>(
    'SELECT id, phone, name FROM contacts WHERE list_id = ? ORDER BY RAND()',
    [campaign.list_id],
  )

  let sessionIndex = 0
  let sent = 0
  let failed = 0

  for (const contact of contacts) {
    const currentCampaign = await queryOne<{ status: string }>(
      'SELECT status FROM campaigns WHERE id = ?',
      [campaignId],
    )
    if (currentCampaign?.status === 'paused' || currentCampaign?.status === 'failed') {
      logger.info({ campaignId }, 'Campanha pausada ou cancelada')
      break
    }

    const sessionId = connectedSessions[sessionIndex % connectedSessions.length]
    if (campaign.rotate_sessions) sessionIndex++

    const logId = uuidv4()
    await query(
      "INSERT INTO campaign_logs (id, campaign_id, contact_id, phone, status, session_id) VALUES (?, ?, ?, ?, 'pending', ?)",
      [logId, campaignId, contact.id, contact.phone, sessionId],
    )

    try {
      const message = await generateMessage(
        campaign.ai_provider,
        campaign.prompt,
        contact.name || '',
        contact.phone,
      )

      if (campaign.media_type === 'none') {
        await baileysService.sendText(sessionId, contact.phone, message)
      } else if (campaign.media_type === 'image' && campaign.media_path) {
        const imagePath = path.join(UPLOADS_DIR, campaign.media_path)
        await baileysService.sendImage(sessionId, contact.phone, imagePath, message)
      } else if (campaign.media_type === 'audio') {
        const audioPath = path.join(TEMP_DIR, `${logId}.ogg`)
        fs.mkdirSync(TEMP_DIR, { recursive: true })
        await generateAudio(campaign.ai_provider, message, audioPath)

        if (campaign.media_path) {
          const imagePath = path.join(UPLOADS_DIR, campaign.media_path)
          await baileysService.sendImageWithAudio(
            sessionId,
            contact.phone,
            imagePath,
            audioPath,
            message,
          )
        } else {
          await baileysService.sendAudio(sessionId, contact.phone, audioPath)
        }

        fs.unlink(audioPath, () => null)
      }

      await query(
        "UPDATE campaign_logs SET status = 'sent', message = ?, sent_at = NOW() WHERE id = ?",
        [message, logId],
      )
      sent++

      await query('UPDATE campaigns SET sent = ? WHERE id = ?', [sent, campaignId])
      campaignWsEmitter.emit('campaign:progress', {
        campaignId,
        sent,
        failed,
        total: contacts.length,
        phone: contact.phone,
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
        status: 'failed',
        error: errorMsg,
      })
      logger.warn({ err, campaignId, phone: contact.phone }, 'Falha ao enviar mensagem')
    }

    if (contact !== contacts[contacts.length - 1]) {
      await new Promise((r) => setTimeout(r, randomDelay(campaign.min_delay, campaign.max_delay)))
    }
  }

  await query(
    "UPDATE campaigns SET status = 'completed', sent = ?, failed = ? WHERE id = ?",
    [sent, failed, campaignId],
  )
  campaignWsEmitter.emit('campaign:update', { campaignId, status: 'completed', sent, failed })
  logger.info({ campaignId, sent, failed }, 'Campanha concluída')
}
