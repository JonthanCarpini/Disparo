import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { query, queryOne } from '../lib/db'
import { campaignQueue } from '../workers/CampaignWorker'
import { campaignWsEmitter } from '../lib/wsEmitter'
import { logger } from '../lib/logger'
import { generateMessage, AIProvider } from '../services/AIService'
import { baileysService } from '../services/BaileysService'

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

export async function campaignsRoutes(app: FastifyInstance) {
  app.get('/campaigns', { preHandler: [app.authenticate] }, async () => {
    return query(
      `SELECT c.*, cl.name as list_name
       FROM campaigns c
       LEFT JOIN contact_lists cl ON c.list_id = cl.id
       ORDER BY c.created_at DESC`,
    )
  })

  app.get('/campaigns/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const campaign = await queryOne('SELECT * FROM campaigns WHERE id = ?', [id])
    if (!campaign) return reply.status(404).send({ error: 'Campanha não encontrada' })
    return campaign
  })

  app.get('/campaigns/:id/logs', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const { page = '1', limit = '50' } = req.query as { page?: string; limit?: string }
    const limitVal = Math.max(1, parseInt(limit) || 50)
    const offset = (Math.max(1, parseInt(page) || 1) - 1) * limitVal
    return query(
      `SELECT * FROM campaign_logs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ${limitVal} OFFSET ${offset}`,
      [id],
    )
  })

  app.post('/campaigns', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parts = req.parts()
    const fields: Record<string, string> = {}
    let mediaPath: string | null = null

    for await (const part of parts) {
      if (part.type === 'field') {
        fields[part.fieldname] = part.value as string
      } else if (part.type === 'file' && part.fieldname === 'media') {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true })
        const ext = path.extname(part.filename || '.jpg')
        const filename = `${uuidv4()}${ext}`
        const filepath = path.join(UPLOADS_DIR, filename)
        const chunks: Buffer[] = []
        for await (const chunk of part.file) {
          chunks.push(chunk as Buffer)
        }
        fs.writeFileSync(filepath, Buffer.concat(chunks))
        mediaPath = filename
      }
    }

    const {
      name,
      list_id,
      ai_provider,
      ai_model,
      prompt,
      media_type = 'none',
      min_delay = '5',
      max_delay = '15',
      max_per_day = '0',
      max_per_session_day = '0',
      start_time,
      end_time,
      rotate_sessions = 'true',
      session_ids,
      scheduled_at,
    } = fields

    if (!name || !list_id || !ai_provider || !prompt || !session_ids) {
      return reply.status(400).send({ error: 'Campos obrigatórios: name, list_id, ai_provider, prompt, session_ids' })
    }

    const id = uuidv4()
    const listInfo = await queryOne<{ total: number }>(
      'SELECT total FROM contact_lists WHERE id = ?',
      [list_id],
    )

    await query(
      `INSERT INTO campaigns
        (id, name, list_id, ai_provider, ai_model, prompt, media_type, media_path,
         min_delay, max_delay, max_per_day, max_per_session_day, start_time, end_time,
         rotate_sessions, session_ids, scheduled_at, total, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        id, name, list_id, ai_provider, ai_model || null, prompt,
        media_type, mediaPath, parseInt(min_delay), parseInt(max_delay),
        parseInt(max_per_day) || 0,
        parseInt(max_per_session_day) || 0,
        start_time || null, end_time || null,
        rotate_sessions === 'true' ? 1 : 0, session_ids,
        scheduled_at || null, listInfo?.total || 0,
      ],
    )

    if (!scheduled_at) {
      await startCampaign(id)
    }

    return { id, status: scheduled_at ? 'scheduled' : 'running' }
  })

  app.post('/campaigns/:id/pause', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = await queryOne<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [id])
    if (!c) return reply.status(404).send({ error: 'Campanha não encontrada' })
    if (c.status !== 'running') return reply.status(400).send({ error: 'Campanha não está rodando' })
    await query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [id])
    return { message: 'Campanha pausada' }
  })

  app.post('/campaigns/:id/resume', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = await queryOne<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [id])
    if (!c) return reply.status(404).send({ error: 'Campanha não encontrada' })
    if (c.status !== 'paused' && c.status !== 'failed') {
      return reply.status(400).send({ error: 'Campanha não pode ser retomada (status atual: ' + c.status + ')' })
    }
    await startCampaign(id)
    return { message: 'Campanha retomada' }
  })

  app.post('/campaigns/test-message', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { ai_provider, ai_model, prompt, list_id, count = 3 } = req.body as {
      ai_provider: AIProvider
      ai_model?: string
      prompt: string
      list_id: string
      count?: number
    }

    if (!ai_provider || !prompt || !list_id) {
      return reply.status(400).send({ error: 'ai_provider, prompt e list_id são obrigatórios' })
    }

    const limitVal = Math.min(Math.max(Math.trunc(Number(count) || 1), 1), 5)
    const sample = await query<{ phone: string; name: string | null }>(
      `SELECT phone, name FROM contacts WHERE list_id = ? ORDER BY RAND() LIMIT ${limitVal}`,
      [list_id],
    )
    if (sample.length === 0) return reply.status(404).send({ error: 'Lista vazia' })

    const previews = []
    for (const c of sample) {
      try {
        const message = await generateMessage(ai_provider, prompt, c.name || '', c.phone, ai_model || undefined)
        previews.push({ phone: c.phone, name: c.name, message })
      } catch (err) {
        previews.push({ phone: c.phone, name: c.name, error: String(err) })
      }
    }
    return { previews }
  })

  app.post('/campaigns/:id/test-send', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { count = 3 } = (req.body || {}) as { count?: number }

    const campaign = await queryOne<{
      id: string
      list_id: string
      ai_provider: AIProvider
      ai_model: string | null
      prompt: string
      session_ids: string
    }>('SELECT id, list_id, ai_provider, ai_model, prompt, session_ids FROM campaigns WHERE id = ?', [id])
    if (!campaign) return reply.status(404).send({ error: 'Campanha não encontrada' })

    const sessionIds: string[] = Array.isArray(campaign.session_ids)
      ? campaign.session_ids as unknown as string[]
      : JSON.parse(campaign.session_ids || '[]')
    const sessionId = sessionIds.find((s) => baileysService.isConnected(s))
    if (!sessionId) return reply.status(400).send({ error: 'Nenhuma sessão conectada' })

    const sampleLimit = Math.min(Math.max(Math.trunc(Number(count) || 1), 1), 10)
    const sample = await query<{ id: string; phone: string; jid: string | null; name: string | null }>(
      `SELECT id, phone, jid, name FROM contacts WHERE list_id = ? ORDER BY RAND() LIMIT ${sampleLimit}`,
      [campaign.list_id],
    )

    const results = []
    for (const c of sample) {
      try {
        const message = await generateMessage(
          campaign.ai_provider, campaign.prompt, c.name || '', c.phone, campaign.ai_model || undefined,
        )
        const target = c.jid || c.phone
        await baileysService.sendText(sessionId, target, message)
        results.push({ phone: c.phone, status: 'sent', message })
      } catch (err) {
        results.push({ phone: c.phone, status: 'failed', error: String(err) })
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    return { results }
  })

  app.get('/campaigns/:id/contacts-status', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const { page = '1', limit = '50', status } = req.query as {
      page?: string; limit?: string; status?: string
    }
    const limitVal = Math.max(1, parseInt(limit) || 50)
    const offset = (Math.max(1, parseInt(page) || 1) - 1) * limitVal

    const campaign = await queryOne<{ list_id: string }>('SELECT list_id FROM campaigns WHERE id = ?', [id])
    if (!campaign) return { contacts: [], totals: null }

    const baseFilter = status === 'aguardando' ? 'AND cl.id IS NULL'
      : status === 'sent' ? "AND cl.status = 'sent'"
      : status === 'failed' ? "AND cl.status = 'failed'"
      : ''

    const rows = await query<{
      contact_id: string; phone: string; name: string | null; jid: string | null;
      status: string | null; sent_at: string | null; error: string | null
    }>(
      `SELECT c.id AS contact_id, c.phone, c.name, c.jid,
              COALESCE(cl.status, 'aguardando') AS status,
              cl.sent_at, cl.error
       FROM contacts c
       LEFT JOIN (
         SELECT contact_id, status, sent_at, error,
                ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at DESC) AS rn
         FROM campaign_logs WHERE campaign_id = ?
       ) cl ON cl.contact_id = c.id AND cl.rn = 1
       WHERE c.list_id = ? ${baseFilter}
       ORDER BY c.created_at
       LIMIT ${limitVal} OFFSET ${offset}`,
      [id, campaign.list_id],
    )

    const totals = await queryOne<{
      total: number; sent: number; failed: number; aguardando: number
    }>(
      `SELECT
         (SELECT COUNT(*) FROM contacts WHERE list_id = ?) AS total,
         (SELECT COUNT(DISTINCT contact_id) FROM campaign_logs WHERE campaign_id = ? AND status = 'sent') AS sent,
         (SELECT COUNT(DISTINCT contact_id) FROM campaign_logs WHERE campaign_id = ? AND status = 'failed') AS failed,
         (SELECT COUNT(*) FROM contacts WHERE list_id = ?) -
         (SELECT COUNT(DISTINCT contact_id) FROM campaign_logs WHERE campaign_id = ?) AS aguardando`,
      [campaign.list_id, id, id, campaign.list_id, id],
    )

    return { contacts: rows, totals }
  })

  app.delete('/campaigns/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = await queryOne('SELECT id FROM campaigns WHERE id = ?', [id])
    if (!c) return reply.status(404).send({ error: 'Campanha não encontrada' })
    await query("UPDATE campaigns SET status = 'failed' WHERE id = ?", [id])
    await query('DELETE FROM campaigns WHERE id = ?', [id])
    return { message: 'Campanha removida' }
  })

  app.put('/campaigns/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = await queryOne<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [id])
    if (!c) return reply.status(404).send({ error: 'Campanha não encontrada' })
    if (c.status === 'running') return reply.status(400).send({ error: 'Pause a campanha antes de editar' })

    const {
      name, ai_provider, ai_model, prompt,
      min_delay, max_delay, max_per_day, max_per_session_day,
      start_time, end_time, rotate_sessions, session_ids,
    } = req.body as {
      name?: string; ai_provider?: string; ai_model?: string; prompt?: string
      min_delay?: number; max_delay?: number; max_per_day?: number; max_per_session_day?: number
      start_time?: string; end_time?: string
      rotate_sessions?: boolean; session_ids?: string
    }

    const updates: string[] = []
    const values: unknown[] = []
    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (ai_provider !== undefined) { updates.push('ai_provider = ?'); values.push(ai_provider) }
    if (ai_model !== undefined) { updates.push('ai_model = ?'); values.push(ai_model || null) }
    if (prompt !== undefined) { updates.push('prompt = ?'); values.push(prompt) }
    if (min_delay !== undefined) { updates.push('min_delay = ?'); values.push(Number(min_delay)) }
    if (max_delay !== undefined) { updates.push('max_delay = ?'); values.push(Number(max_delay)) }
    if (max_per_day !== undefined) { updates.push('max_per_day = ?'); values.push(Number(max_per_day)) }
    if (max_per_session_day !== undefined) { updates.push('max_per_session_day = ?'); values.push(Number(max_per_session_day)) }
    if (start_time !== undefined) { updates.push('start_time = ?'); values.push(start_time || null) }
    if (end_time !== undefined) { updates.push('end_time = ?'); values.push(end_time || null) }
    if (rotate_sessions !== undefined) { updates.push('rotate_sessions = ?'); values.push(rotate_sessions ? 1 : 0) }
    if (session_ids !== undefined) { updates.push('session_ids = ?'); values.push(session_ids) }

    if (updates.length > 0) {
      values.push(id)
      await query(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`, values)
    }
    return { message: 'Campanha atualizada' }
  })

  app.get('/campaigns/ws', { websocket: true }, (socket) => {
    logger.info('Cliente WebSocket conectado (campaigns)')

    const onUpdate = (data: unknown) => socket.send(JSON.stringify({ event: 'update', ...data as object }))
    const onProgress = (data: unknown) => socket.send(JSON.stringify({ event: 'progress', ...data as object }))
    const onSending = (data: unknown) => socket.send(JSON.stringify({ event: 'sending', ...data as object }))

    campaignWsEmitter.on('campaign:update', onUpdate)
    campaignWsEmitter.on('campaign:progress', onProgress)
    campaignWsEmitter.on('campaign:sending', onSending)

    socket.on('close', () => {
      campaignWsEmitter.off('campaign:update', onUpdate)
      campaignWsEmitter.off('campaign:progress', onProgress)
      campaignWsEmitter.off('campaign:sending', onSending)
    })
  })
}

async function startCampaign(campaignId: string) {
  await query("UPDATE campaigns SET status = 'running' WHERE id = ?", [campaignId])
  await campaignQueue.add({ campaignId }, { jobId: `${campaignId}-${Date.now()}` })
  logger.info({ campaignId }, 'Campanha adicionada à fila')
}
