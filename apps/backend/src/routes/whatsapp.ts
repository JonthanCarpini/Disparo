import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { query, queryOne } from '../lib/db'
import { baileysService } from '../services/BaileysService'
import { baileysWsEmitter } from '../lib/wsEmitter'
import { logger } from '../lib/logger'

export async function whatsappRoutes(app: FastifyInstance) {
  app.get('/whatsapp/sessions', { preHandler: [app.authenticate] }, async () => {
    const sessions = await query(
      'SELECT id, name, phone, status, created_at FROM whatsapp_sessions ORDER BY created_at DESC',
    )
    return sessions
  })

  app.post('/whatsapp/sessions', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req) => {
    const { name } = req.body as { name: string }
    const id = uuidv4()
    await query(
      "INSERT INTO whatsapp_sessions (id, name, status) VALUES (?, ?, 'disconnected')",
      [id, name],
    )
    await baileysService.connect(id)
    return { id, name, status: 'connecting' }
  })

  app.delete('/whatsapp/sessions/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await queryOne('SELECT id FROM whatsapp_sessions WHERE id = ?', [id])
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' })
    await baileysService.disconnect(id)
    await query('DELETE FROM whatsapp_sessions WHERE id = ?', [id])
    return { message: 'Sessão removida' }
  })

  app.post('/whatsapp/sessions/:id/reconnect', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await queryOne('SELECT id FROM whatsapp_sessions WHERE id = ?', [id])
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' })
    await baileysService.connect(id)
    return { message: 'Reconectando...' }
  })

  app.get('/whatsapp/sessions/:id/groups', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!baileysService.isConnected(id)) {
      return reply.status(400).send({ error: 'Sessão não conectada' })
    }
    const groups = await baileysService.getGroups(id)
    return groups
  })

  app.get('/whatsapp/sessions/:id/groups/:groupId/participants', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { id, groupId } = req.params as { id: string; groupId: string }
    if (!baileysService.isConnected(id)) {
      return reply.status(400).send({ error: 'Sessão não conectada' })
    }
    const participants = await baileysService.getGroupParticipants(id, groupId)
    return participants
  })

  app.get('/whatsapp/sessions/:id/contacts', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!baileysService.isConnected(id)) {
      return reply.status(400).send({ error: 'Sessão não conectada' })
    }
    const contacts = await baileysService.getContacts(id)
    return contacts
  })

  app.get('/whatsapp/ws', { websocket: true }, (socket) => {
    logger.info('Cliente WebSocket conectado (whatsapp)')

    const unsubQR = baileysService.onQR((sessionId, qr) => {
      socket.send(JSON.stringify({ event: 'qr', sessionId, qr }))
    })

    const unsubStatus = baileysService.onStatus((sessionId, status, phone) => {
      socket.send(JSON.stringify({ event: 'status', sessionId, status, phone }))
    })

    socket.on('close', () => {
      unsubQR()
      unsubStatus()
    })
  })
}
