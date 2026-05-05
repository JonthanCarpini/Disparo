import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { query, queryOne } from '../lib/db'
import { generateApiKey, apiKeyAuth } from '../lib/apiKeyAuth'
import { logger } from '../lib/logger'

interface ImportParticipant {
  phone?: string
  jid?: string
  name?: string | null
}

interface ImportGroupBody {
  groupJid: string
  subject?: string | null
  participants: ImportParticipant[]
}

const PHONE_RE = /^\d{10,15}$/

function normalizeFromJid(jid: string): { phone: string; jid: string } | null {
  if (!jid) return null
  const num = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (!PHONE_RE.test(num)) return null
  if (jid.includes('@lid')) return { phone: num, jid: `${num}@lid` }
  return { phone: num, jid: `${num}@s.whatsapp.net` }
}

function normalizeParticipant(p: ImportParticipant): { phone: string; jid: string; name: string } | null {
  let result: { phone: string; jid: string } | null = null
  if (p.phone) {
    const num = p.phone.replace(/\D/g, '')
    if (PHONE_RE.test(num)) result = { phone: num, jid: `${num}@s.whatsapp.net` }
  }
  if (!result && p.jid) result = normalizeFromJid(p.jid)
  if (!result) return null
  return { ...result, name: (p.name || '').toString().slice(0, 200) }
}

export async function integrationsRoutes(app: FastifyInstance) {
  // ===== Gestão de API keys (auth JWT) =====

  app.get('/integrations/keys', { preHandler: [app.authenticate] }, async () => {
    return query<{
      id: number; label: string; key_preview: string; enabled: number;
      last_used_at: string | null; created_at: string
    }>(
      `SELECT id, label, key_preview, enabled, last_used_at, created_at
       FROM api_keys ORDER BY created_at DESC`,
    )
  })

  app.post('/integrations/keys', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { label } = req.body as { label?: string }
    if (!label || label.trim().length === 0) {
      return reply.status(400).send({ error: 'label obrigatório' })
    }

    const { plain, hash, preview } = generateApiKey()
    const result = await query<{ insertId: number }>(
      'INSERT INTO api_keys (label, key_hash, key_preview, enabled) VALUES (?, ?, ?, 1)',
      [label.trim().slice(0, 120), hash, preview],
    ) as unknown as { insertId: number }

    return {
      id: (result as { insertId?: number }).insertId ?? null,
      label: label.trim(),
      key: plain,
      key_preview: preview,
      message: 'Guarde esta chave agora — ela não será mostrada novamente.',
    }
  })

  app.put('/integrations/keys/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { enabled, label } = req.body as { enabled?: boolean; label?: string }

    const updates: string[] = []
    const values: unknown[] = []
    if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0) }
    if (label !== undefined) { updates.push('label = ?'); values.push(label.trim().slice(0, 120)) }
    if (updates.length === 0) return reply.status(400).send({ error: 'Nada para atualizar' })
    values.push(id)
    await query(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`, values)
    return { message: 'API key atualizada' }
  })

  app.delete('/integrations/keys/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    await query('DELETE FROM api_keys WHERE id = ?', [id])
    return { message: 'API key removida' }
  })

  // ===== Endpoint público para n8n (auth via X-API-Key) =====

  app.post('/integrations/import-group', { preHandler: [apiKeyAuth] }, async (req, reply) => {
    const body = req.body as ImportGroupBody

    if (!body || !body.groupJid || !Array.isArray(body.participants)) {
      return reply.status(400).send({
        error: 'Payload inválido. Esperado: { groupJid, subject?, participants: [{phone|jid, name?}] }',
      })
    }

    const normalized: { phone: string; jid: string; name: string }[] = []
    const seen = new Set<string>()
    for (const p of body.participants) {
      const n = normalizeParticipant(p)
      if (!n) continue
      if (seen.has(n.jid)) continue
      seen.add(n.jid)
      normalized.push(n)
    }

    const subject = (body.subject || body.groupJid).toString().slice(0, 200)
    const groupJid = body.groupJid.toString().slice(0, 120)

    // Upsert da lista por source_jid
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM contact_lists WHERE source_jid = ? LIMIT 1',
      [groupJid],
    )

    let listId: string
    let added = 0
    let skipped = 0

    if (existing) {
      listId = existing.id
      await query(
        'UPDATE contact_lists SET name = ? WHERE id = ?',
        [subject, listId],
      )

      // Pega JIDs já existentes para deduplicar
      const existingRows = await query<{ jid: string }>(
        'SELECT jid FROM contacts WHERE list_id = ? AND jid IS NOT NULL',
        [listId],
      )
      const existingJids = new Set(existingRows.map((r) => r.jid))
      const toInsert = normalized.filter((c) => !existingJids.has(c.jid))
      skipped = normalized.length - toInsert.length
      added = toInsert.length

      if (toInsert.length > 0) {
        await bulkInsert(listId, toInsert)
        await query(
          `UPDATE contact_lists SET total = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?`,
          [listId, listId],
        )
      }
    } else {
      listId = uuidv4()
      await query(
        `INSERT INTO contact_lists (id, name, source, source_jid, total)
         VALUES (?, ?, 'n8n_group_import', ?, ?)`,
        [listId, subject, groupJid, normalized.length],
      )
      await bulkInsert(listId, normalized)
      added = normalized.length
    }

    logger.info({ groupJid, subject, total: normalized.length, added, skipped }, 'Importação n8n')

    return {
      listId,
      groupJid,
      subject,
      received: body.participants.length,
      valid: normalized.length,
      added,
      skipped,
      created: !existing,
    }
  })
}

async function bulkInsert(
  listId: string,
  contacts: { phone: string; jid: string; name: string }[],
): Promise<void> {
  if (contacts.length === 0) return
  const BATCH = 500
  for (let i = 0; i < contacts.length; i += BATCH) {
    const slice = contacts.slice(i, i + BATCH)
    const placeholders = slice.map(() => '(?, ?, ?, ?, ?)').join(', ')
    const values: string[] = []
    for (const c of slice) {
      values.push(uuidv4(), listId, c.phone, c.jid, c.name)
    }
    await query(
      `INSERT INTO contacts (id, list_id, phone, jid, name) VALUES ${placeholders}`,
      values,
    )
  }
}
