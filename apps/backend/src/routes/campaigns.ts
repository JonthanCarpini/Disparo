import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { query, queryOne } from '../lib/db'
import { campaignQueue } from '../workers/CampaignWorker'
import { campaignWsEmitter } from '../lib/wsEmitter'
import { logger } from '../lib/logger'

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
    const offset = (parseInt(page) - 1) * parseInt(limit)
    return query(
      'SELECT * FROM campaign_logs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [id, parseInt(limit), offset],
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
         min_delay, max_delay, rotate_sessions, session_ids, scheduled_at, total, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        id, name, list_id, ai_provider, ai_model || null, prompt,
        media_type, mediaPath, parseInt(min_delay), parseInt(max_delay),
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
    if (c.status !== 'paused') return reply.status(400).send({ error: 'Campanha não está pausada' })
    await startCampaign(id)
    return { message: 'Campanha retomada' }
  })

  app.delete('/campaigns/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = await queryOne('SELECT id FROM campaigns WHERE id = ?', [id])
    if (!c) return reply.status(404).send({ error: 'Campanha não encontrada' })
    await query("UPDATE campaigns SET status = 'failed' WHERE id = ?", [id])
    await query('DELETE FROM campaigns WHERE id = ?', [id])
    return { message: 'Campanha removida' }
  })

  app.get('/campaigns/ws', { websocket: true }, (socket) => {
    logger.info('Cliente WebSocket conectado (campaigns)')

    const onUpdate = (data: unknown) => socket.send(JSON.stringify({ event: 'update', ...data as object }))
    const onProgress = (data: unknown) => socket.send(JSON.stringify({ event: 'progress', ...data as object }))

    campaignWsEmitter.on('campaign:update', onUpdate)
    campaignWsEmitter.on('campaign:progress', onProgress)

    socket.on('close', () => {
      campaignWsEmitter.off('campaign:update', onUpdate)
      campaignWsEmitter.off('campaign:progress', onProgress)
    })
  })
}

async function startCampaign(campaignId: string) {
  await query("UPDATE campaigns SET status = 'running' WHERE id = ?", [campaignId])
  await campaignQueue.add({ campaignId }, { jobId: campaignId })
  logger.info({ campaignId }, 'Campanha adicionada à fila')
}
