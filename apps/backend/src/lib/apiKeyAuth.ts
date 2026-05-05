import { createHash, randomBytes } from 'crypto'
import { FastifyReply, FastifyRequest } from 'fastify'
import { query, queryOne } from './db'
import { logger } from './logger'

const KEY_PREFIX = 'dsp_'

export function generateApiKey(): { plain: string; hash: string; preview: string } {
  const random = randomBytes(32).toString('base64url')
  const plain = `${KEY_PREFIX}${random}`
  const hash = createHash('sha256').update(plain).digest('hex')
  const preview = `${plain.slice(0, 10)}...${plain.slice(-4)}`
  return { plain, hash, preview }
}

export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

export async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply) {
  const headerKey = (req.headers['x-api-key'] || req.headers['X-API-Key']) as string | undefined
  if (!headerKey) {
    return reply.status(401).send({ error: 'Header X-API-Key obrigatório' })
  }

  const hash = hashApiKey(headerKey)
  const row = await queryOne<{ id: number; enabled: number }>(
    'SELECT id, enabled FROM api_keys WHERE key_hash = ? LIMIT 1',
    [hash],
  )

  if (!row || !row.enabled) {
    logger.warn({ ip: req.ip }, 'Tentativa de acesso com API key inválida')
    return reply.status(401).send({ error: 'API key inválida ou desativada' })
  }

  query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [row.id]).catch(() => null)
}
