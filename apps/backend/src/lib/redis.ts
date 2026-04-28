import { createClient } from 'redis'
import { logger } from './logger'

let client: ReturnType<typeof createClient> | null = null

export async function getRedis() {
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL || 'redis://redis:6379',
    })
    client.on('error', (err) => logger.error({ err }, 'Redis error'))
    await client.connect()
    logger.info('Redis conectado')
  }
  return client
}
