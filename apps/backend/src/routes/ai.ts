import { FastifyInstance } from 'fastify'
import { query, queryOne } from '../lib/db'

const PROVIDERS = ['openai', 'gemini', 'groq', 'mistral'] as const

export async function aiRoutes(app: FastifyInstance) {
  app.get('/ai/configs', { preHandler: [app.authenticate] }, async () => {
    const configs = await query(
      'SELECT provider, model, enabled, updated_at FROM ai_configs ORDER BY provider',
    )
    return configs
  })

  app.put('/ai/configs/:provider', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { provider } = req.params as { provider: string }
    if (!PROVIDERS.includes(provider as never)) {
      return reply.status(400).send({ error: `Provedor inválido. Use: ${PROVIDERS.join(', ')}` })
    }

    const { api_key, model, enabled } = req.body as {
      api_key?: string
      model?: string
      enabled?: boolean
    }

    const existing = await queryOne('SELECT provider FROM ai_configs WHERE provider = ?', [provider])

    if (existing) {
      const updates: string[] = []
      const values: unknown[] = []
      if (api_key !== undefined) { updates.push('api_key = ?'); values.push(api_key) }
      if (model !== undefined) { updates.push('model = ?'); values.push(model) }
      if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0) }
      if (updates.length > 0) {
        values.push(provider)
        await query(`UPDATE ai_configs SET ${updates.join(', ')} WHERE provider = ?`, values)
      }
    } else {
      if (!api_key) return reply.status(400).send({ error: 'api_key obrigatória para novo provedor' })
      await query(
        'INSERT INTO ai_configs (provider, api_key, model, enabled) VALUES (?, ?, ?, ?)',
        [provider, api_key, model || null, enabled !== false ? 1 : 0],
      )
    }

    return { message: 'Configuração salva', provider }
  })

  app.post('/ai/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { provider, prompt } = req.body as { provider: string; prompt?: string }
    if (!PROVIDERS.includes(provider as never)) {
      return reply.status(400).send({ error: 'Provedor inválido' })
    }

    const { generateMessage } = await import('../services/AIService')
    try {
      const message = await generateMessage(
        provider as 'openai' | 'gemini' | 'groq' | 'mistral',
        prompt || 'Olá! Me apresente de forma simpática.',
        'João',
        '5511999999999',
      )
      return { message }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: errorMsg })
    }
  })

  app.get('/ai/keys/:provider', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { provider } = req.params as { provider: string }
    if (!PROVIDERS.includes(provider as never)) {
      return reply.status(400).send({ error: 'Provedor inválido' })
    }
    return query<{ id: number; label: string; api_key_preview: string; enabled: number; created_at: string }>(
      `SELECT id, label, enabled, created_at,
        CONCAT(SUBSTRING(api_key, 1, 8), '...') as api_key_preview
       FROM ai_provider_keys WHERE provider = ? ORDER BY id`,
      [provider],
    )
  })

  app.post('/ai/keys/:provider', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { provider } = req.params as { provider: string }
    if (!PROVIDERS.includes(provider as never)) {
      return reply.status(400).send({ error: 'Provedor inválido' })
    }
    const { api_key, label } = req.body as { api_key: string; label?: string }
    if (!api_key) return reply.status(400).send({ error: 'api_key obrigatória' })
    const count = await queryOne<{ total: number }>('SELECT COUNT(*) as total FROM ai_provider_keys WHERE provider = ?', [provider])
    const defaultLabel = label || `Conta ${(count?.total ?? 0) + 1}`
    await query('INSERT INTO ai_provider_keys (provider, label, api_key) VALUES (?, ?, ?)', [provider, defaultLabel, api_key])
    return { message: 'Chave adicionada' }
  })

  app.put('/ai/keys/:provider/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { provider, id } = req.params as { provider: string; id: string }
    const { label, enabled } = req.body as { label?: string; enabled?: boolean }
    const updates: string[] = []
    const values: unknown[] = []
    if (label !== undefined) { updates.push('label = ?'); values.push(label) }
    if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0) }
    if (updates.length > 0) {
      values.push(parseInt(id), provider)
      await query(`UPDATE ai_provider_keys SET ${updates.join(', ')} WHERE id = ? AND provider = ?`, values)
    }
    return { message: 'Chave atualizada' }
  })

  app.delete('/ai/keys/:provider/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { provider, id } = req.params as { provider: string; id: string }
    await query('DELETE FROM ai_provider_keys WHERE id = ? AND provider = ?', [parseInt(id), provider])
    return { message: 'Chave removida' }
  })

  app.get('/ai/models', { preHandler: [app.authenticate] }, async () => {
    return {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
      groq: [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
      ],
      mistral: [
        'mistral-large-latest',
        'mistral-medium-latest',
        'mistral-small-latest',
        'ministral-8b-latest',
        'ministral-3b-latest',
        'open-mistral-7b',
        'open-mixtral-8x7b',
        'open-mixtral-8x22b',
      ],
    }
  })
}
