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
  max_per_session_day: number
  daily_sent: number
  last_send_date: string | null
  start_time: string | null
  end_time: string | null
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

function isWithinTimeWindow(startTime: string | null, endTime: string | null): boolean {
  if (!startTime || !endTime) return true
  const now = new Date()
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  if (startMins <= endMins) {
    return nowMins >= startMins && nowMins < endMins
  }
  return nowMins >= startMins || nowMins < endMins
}

function shouldRetryAI(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (/429/.test(msg)) return true
  if (/capacity exceeded/i.test(msg)) return true
  if (/5\d\d/.test(msg)) return true
  return false
}

async function generateWithRetry(provider: AIProvider, prompt: string, name: string, phone: string, model?: string) {
  const attempts = [0, 2000, 5000] // imediato, 2s, 5s
  let lastErr: unknown
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) {
      await new Promise((r) => setTimeout(r, attempts[i]))
    }
    try {
      return await generateMessage(provider, prompt, name, phone, model)
    } catch (err) {
      lastErr = err
      if (!shouldRetryAI(err) || i === attempts.length - 1) break
    }
  }
  throw lastErr
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

  const sessionWarmingLimits = new Map<string, number>()
  if (sessionIds.length > 0) {
    const warmingRows = await query<{ id: string; warming_daily_limit: number }>(
      `SELECT id, warming_daily_limit FROM whatsapp_sessions WHERE id IN (${sessionIds.map(() => '?').join(',')})`,
      sessionIds,
    )
    for (const row of warmingRows) {
      sessionWarmingLimits.set(row.id, row.warming_daily_limit)
    }
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
  let interrupted = false

  const today = new Date().toISOString().slice(0, 10)
  let dailySent = campaign.last_send_date === today ? (campaign.daily_sent || 0) : 0
  if (campaign.last_send_date !== today) {
    await query(
      'UPDATE campaigns SET daily_sent = 0, last_send_date = ? WHERE id = ?',
      [today, campaignId],
    )
  }

  // Restore per-session daily sent from logs (for resume accuracy)
  const sessionDailySent = new Map<string, number>()
  if (campaign.max_per_session_day > 0) {
    const sessionStats = await query<{ session_id: string; count: number }>(
      `SELECT session_id, COUNT(*) as count
       FROM campaign_logs
       WHERE campaign_id = ? AND DATE(sent_at) = ? AND status = 'sent'
       GROUP BY session_id`,
      [campaignId, today],
    )
    for (const s of sessionStats) {
      sessionDailySent.set(s.session_id, s.count)
    }
  }

  for (const contact of contacts) {
    const currentCampaign = await queryOne<{ status: string }>(
      'SELECT status FROM campaigns WHERE id = ?',
      [campaignId],
    )
    if (currentCampaign?.status === 'paused' || currentCampaign?.status === 'failed') {
      logger.info({ campaignId }, 'Campanha pausada ou cancelada')
      interrupted = true
      break
    }

    if (!isWithinTimeWindow(campaign.start_time, campaign.end_time)) {
      await query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId])
      campaignWsEmitter.emit('campaign:update', { campaignId, status: 'paused', reason: 'outside_time_window' })
      logger.info({ campaignId }, 'Campanha pausada: fora do horário permitido')
      interrupted = true
      break
    }

    if (campaign.max_per_day > 0 && dailySent >= campaign.max_per_day) {
      await query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId])
      campaignWsEmitter.emit('campaign:update', {
        campaignId, status: 'paused', reason: 'max_per_day_reached',
      })
      logger.info({ campaignId, dailySent, max: campaign.max_per_day }, 'Limite diário atingido')
      interrupted = true
      break
    }

    const liveSessions = sessionIds.filter((sid) => baileysService.isConnected(sid))
    if (liveSessions.length === 0) {
      await query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId])
      campaignWsEmitter.emit('campaign:update', { campaignId, status: 'paused', reason: 'no_sessions_available' })
      logger.info({ campaignId }, 'Nenhuma sessão disponível (desconectadas ou banidas)')
      interrupted = true
      break
    }

    const availableSessions = liveSessions.filter((sid) => {
      const warming = sessionWarmingLimits.get(sid) ?? 0
      const campaignLimit = campaign.max_per_session_day
      const limits = [warming, campaignLimit].filter((l) => l > 0)
      const effectiveLimit = limits.length > 0 ? Math.min(...limits) : 0
      return effectiveLimit === 0 || (sessionDailySent.get(sid) ?? 0) < effectiveLimit
    })

    if (availableSessions.length === 0) {
      await query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId])
      campaignWsEmitter.emit('campaign:update', { campaignId, status: 'paused', reason: 'session_limit_reached' })
      logger.info({ campaignId }, 'Limite diário por sessão atingido em todas as sessões')
      interrupted = true
      break
    }

    const sessionId = availableSessions[sessionIndex % availableSessions.length]
    if (campaign.rotate_sessions) sessionIndex++
    sessionDailySent.set(sessionId, (sessionDailySent.get(sessionId) ?? 0) + 1)

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
      const message = await generateWithRetry(
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

  if (!interrupted) {
    await query(
      "UPDATE campaigns SET status = 'completed', sent = ?, failed = ? WHERE id = ?",
      [sent, failed, campaignId],
    )
    campaignWsEmitter.emit('campaign:update', { campaignId, status: 'completed', sent, failed })
    logger.info({ campaignId, sent, failed }, 'Campanha concluída')
  } else {
    await query('UPDATE campaigns SET sent = ?, failed = ? WHERE id = ?', [sent, failed, campaignId])
  }
}
