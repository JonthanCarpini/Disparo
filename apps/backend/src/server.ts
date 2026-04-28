import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import { logger } from './lib/logger'
import { ensureDefaultUser } from './lib/auth'
import { runMigrations } from './lib/migrate'
import { baileysService } from './services/BaileysService'
import { initCampaignQueue } from './workers/CampaignWorker'
import { authRoutes } from './routes/auth'
import { whatsappRoutes } from './routes/whatsapp'
import { contactsRoutes } from './routes/contacts'
import { campaignsRoutes } from './routes/campaigns'
import { aiRoutes } from './routes/ai'

const app = Fastify({
  logger: false,
  trustProxy: true,
})

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

async function bootstrap() {
  const corsOrigin = process.env.CORS_ORIGIN || '*'
  await app.register(cors, {
    origin: corsOrigin === '*' ? true : corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'disparo-jwt-secret-change-me-2026!!',
  })

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  })

  await app.register(websocket)

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Token inválido ou expirado' })
    }
  })

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  await app.register(authRoutes, { prefix: '/api' })
  await app.register(whatsappRoutes, { prefix: '/api' })
  await app.register(contactsRoutes, { prefix: '/api' })
  await app.register(campaignsRoutes, { prefix: '/api' })
  await app.register(aiRoutes, { prefix: '/api' })

  const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
  initCampaignQueue(REDIS_URL)

  await runMigrations()
  await ensureDefaultUser()
  await baileysService.loadAllSessions()

  const PORT = parseInt(process.env.PORT || '3333')
  await app.listen({ port: PORT, host: '0.0.0.0' })
  logger.info(`Backend rodando na porta ${PORT}`)
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Falha ao iniciar o servidor')
  process.exit(1)
})

type FastifyRequest = Parameters<typeof app.authenticate>[0]
type FastifyReply = Parameters<typeof app.authenticate>[1]
