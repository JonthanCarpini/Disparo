import { FastifyInstance } from 'fastify'
import { query, queryOne } from '../lib/db'

const PROVIDERS = ['openai', 'gemini', 'groq'] as const

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
        provider as 'openai' | 'gemini' | 'groq',
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
    }
  })
}
