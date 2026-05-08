import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { query, queryOne } from '../lib/db'
import { generateApiKey, apiKeyAuth } from '../lib/apiKeyAuth'
import { logger } from '../lib/logger'
import { groupJoinQueue } from '../workers/GroupJoinWorker'
import { baileysService } from '../services/BaileysService'

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
  // ===== Configuração do webhook N8N =====

  app.get('/integrations/n8n-webhook', { preHandler: [app.authenticate] }, async () => {
    const row = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE `key` = 'n8n_webhook_url'",
    )
    return { url: row?.value || '' }
  })

  // Pausar/retomar processamento de joins (kill switch para o worker)
  app.post('/integrations/group-joins/pause', { preHandler: [app.authenticate] }, async () => {
    await query(
      "INSERT INTO settings (`key`, `value`) VALUES ('group_join_paused', 'true') ON DUPLICATE KEY UPDATE `value` = 'true'",
    )
    return { paused: true }
  })

  app.post('/integrations/group-joins/resume', { preHandler: [app.authenticate] }, async () => {
    await query(
      "INSERT INTO settings (`key`, `value`) VALUES ('group_join_paused', 'false') ON DUPLICATE KEY UPDATE `value` = 'false'",
    )
    return { paused: false }
  })

  // ===== Crawler por domínio (JWT) -> navega dentro do mesmo host com BFS limitada =====
  app.post('/integrations/crawl-domain-and-join', { preHandler: [app.authenticate] }, async (req, reply) => {
    const {
      session_ids,
      root_url,
      user_agent,
      max_pages,
      max_depth,
      per_page_limit,
      global_limit,
      chunk_size,
      max_per_session_day,
      start_time,
      end_time,
      path_allow_regex,
      blacklist_paths_regex,
    } = (req.body || {}) as {
      session_ids?: string[]
      root_url?: string
      user_agent?: string
      max_pages?: number
      max_depth?: number
      per_page_limit?: number
      global_limit?: number
      chunk_size?: number
      max_per_session_day?: number
      start_time?: string | null
      end_time?: string | null
      path_allow_regex?: string
      blacklist_paths_regex?: string
    }

    const sessions = Array.isArray(session_ids) ? session_ids.filter(Boolean) : []
    if (sessions.length === 0) return reply.status(400).send({ error: 'session_ids obrigatório (array)' })
    if (!root_url) return reply.status(400).send({ error: 'root_url é obrigatório' })

    let root: URL
    try { root = new URL(root_url) } catch { return reply.status(400).send({ error: 'root_url inválido' }) }
    const host = root.hostname.toLowerCase()
    const ua = user_agent && user_agent.trim().length > 0
      ? user_agent
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
    const MAX_PAGES = Math.max(1, Math.trunc(Number(max_pages) || 50))
    const MAX_DEPTH = Math.max(0, Math.trunc(Number(max_depth) || 3))
    const perPageLimit = Math.max(0, Math.trunc(Number(per_page_limit) || 0))
    const globLimit = Math.max(0, Math.trunc(Number(global_limit) || 0))
    const csize = Math.max(1, Math.trunc(Number(chunk_size) || 50))
    const allowRe = path_allow_regex ? new RegExp(path_allow_regex) : null
    const denyRe = blacklist_paths_regex ? new RegExp(blacklist_paths_regex) : null

    const WAREG = /https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/g

    const q: { url: string; depth: number }[] = [{ url: root.href, depth: 0 }]
    const visited = new Set<string>()
    let pages = 0
    let allLinks: string[] = []
    const perPage: { url: string; found?: number; error?: string }[] = []

    while (q.length && pages < MAX_PAGES) {
      const { url, depth } = q.shift()!
      if (visited.has(url)) continue
      visited.add(url)
      pages++
      try {
        const res = await fetch(url, { headers: { 'User-Agent': ua } })
        const html = await res.text()
        let links = Array.from(new Set(html.match(WAREG) || []))
        if (perPageLimit > 0 && links.length > perPageLimit) links = links.slice(0, perPageLimit)
        allLinks.push(...links)
        perPage.push({ url, found: links.length })

        // Expand próximos URLs do mesmo host
        if (depth < MAX_DEPTH) {
          const hrefs = Array.from(html.matchAll(/href=["']([^"'#]+)["']/gi)).map(m => m[1])
          for (const h of hrefs) {
            let next: URL
            try { next = new URL(h, url) } catch { continue }
            if (next.hostname.toLowerCase() !== host) continue
            if (next.protocol !== 'http:' && next.protocol !== 'https:') continue
            if (allowRe && !allowRe.test(next.pathname)) continue
            if (denyRe && denyRe.test(next.pathname)) continue
            const ext = next.pathname.split('.').pop() || ''
            if (['png','jpg','jpeg','gif','svg','webp','ico','css','js','json','xml','txt'].includes(ext)) continue
            const href = next.href
            if (!visited.has(href) && !q.some(x => x.url === href)) {
              q.push({ url: href, depth: depth + 1 })
            }
          }
        }
      } catch (err) {
        perPage.push({ url, error: String(err) })
      }
      if (globLimit > 0 && allLinks.length >= globLimit) break
    }

    // Dedup & truncate global
    allLinks = Array.from(new Set(allLinks))
    if (globLimit > 0 && allLinks.length > globLimit) allLinks = allLinks.slice(0, globLimit)

    // Chunk e enfileirar
    const chunks: string[][] = []
    for (let i = 0; i < allLinks.length; i += csize) chunks.push(allLinks.slice(i, i + csize))
    let queued = 0
    for (const batch of chunks) {
      await groupJoinQueue.add({
        sessionIds: sessions,
        inviteCodes: batch,
        maxPerSessionDay: Math.trunc(Number(max_per_session_day) || 0),
        startTime: start_time || null,
        endTime: end_time || null,
        source: `crawler:${host}`,
      })
      queued += batch.length
    }

    return {
      domain: host,
      pages_crawled: pages,
      total_found: allLinks.length,
      queued,
      per_page: perPage,
    }
  })

  app.put('/integrations/n8n-webhook', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { url } = req.body as { url?: string }
    if (url === undefined) return reply.status(400).send({ error: 'Campo url obrigatório' })
    await query(
      "INSERT INTO settings (`key`, `value`) VALUES ('n8n_webhook_url', ?) ON DUPLICATE KEY UPDATE `value` = ?",
      [url, url],
    )
    return { message: 'URL salva' }
  })

  app.post('/integrations/trigger-n8n-import', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const row = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE `key` = 'n8n_webhook_url'",
    )
    if (!row?.value) {
      return reply.status(400).send({ error: 'URL do webhook N8N não configurada. Configure em Integrações.' })
    }
    try {
      const res = await fetch(row.value, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) {
        const text = await res.text()
        return reply.status(502).send({ error: `N8N respondeu com erro ${res.status}: ${text}` })
      }
      logger.info('Workflow N8N disparado via botão')
      return { message: 'Workflow N8N iniciado com sucesso' }
    } catch (err) {
      logger.error({ err }, 'Erro ao chamar webhook N8N')
      return reply.status(502).send({ error: 'Não foi possível conectar ao N8N. Verifique a URL configurada.' })
    }
  })

  app.get('/integrations/n8n-last-sync', { preHandler: [app.authenticate] }, async () => {
    const row = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE `key` = 'n8n_last_sync_at'",
    )
    return { completed_at: row?.value || null }
  })

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

  app.post('/integrations/n8n-sync-complete', { preHandler: [apiKeyAuth] }, async (_req, _reply) => {
    const value = new Date().toISOString()
    await query(
      "INSERT INTO settings (`key`, `value`) VALUES ('n8n_last_sync_at', ?) ON DUPLICATE KEY UPDATE `value` = ?",
      [value, value],
    )
    logger.info('Workflow N8N concluído — sinal recebido')
    return { message: 'ok' }
  })

  // ===== Join automático em grupos via link (auth via X-API-Key) =====
  app.post('/integrations/join-groups', { preHandler: [apiKeyAuth] }, async (req, reply) => {
    const { session_ids, invite_links, max_per_session_day, start_time, end_time, source } = (req.body || {}) as {
      session_ids?: string[]
      invite_links?: string[] | string
      max_per_session_day?: number
      start_time?: string | null
      end_time?: string | null
      source?: string
    }

    const sessions = Array.isArray(session_ids) ? session_ids.filter(Boolean) : []
    if (sessions.length === 0) return reply.status(400).send({ error: 'session_ids obrigatório (array)' })

    let links: string[] = []
    if (Array.isArray(invite_links)) links = invite_links
    else if (typeof invite_links === 'string') links = invite_links.split(/\s|,|;|\n/).filter(Boolean)
    if (links.length === 0) return reply.status(400).send({ error: 'invite_links vazio' })

    await groupJoinQueue.add({
      sessionIds: sessions,
      inviteCodes: links,
      maxPerSessionDay: typeof max_per_session_day === 'number' ? max_per_session_day : 0,
      startTime: start_time || null,
      endTime: end_time || null,
      source: source || 'scraper',
    })

    return { queued: links.length, sessions: sessions.length }
  })

  // Auditoria: listar joins
  app.get('/integrations/group-joins', { preHandler: [app.authenticate] }, async (req) => {
    const { status, session_id, page = '1', limit = '50', from, to, source } = req.query as { status?: string; session_id?: string; page?: string; limit?: string; from?: string; to?: string; source?: string }
    const limitVal = Math.max(1, parseInt(limit) || 50)
    const offset = (Math.max(1, parseInt(page) || 1) - 1) * limitVal
    const where: string[] = []
    const values: unknown[] = []
    if (status) { where.push('status = ?'); values.push(status) }
    if (session_id) { where.push('session_id = ?'); values.push(session_id) }
    if (source) { where.push('source = ?'); values.push(source) }
    if (from) { where.push('created_at >= ?'); values.push(from) }
    if (to) { where.push('created_at <= ?'); values.push(to) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return query(
      `SELECT * FROM group_joins ${whereSql} ORDER BY created_at DESC LIMIT ${limitVal} OFFSET ${offset}`,
      values,
    )
  })

  // Sair de um grupo manualmente
  app.post('/integrations/leave-group', { preHandler: [apiKeyAuth] }, async (req, reply) => {
    const { session_id, group_id } = req.body as { session_id?: string; group_id?: string }
    if (!session_id || !group_id) return reply.status(400).send({ error: 'session_id e group_id são obrigatórios' })
    await baileysService.leaveGroup(session_id, group_id)
    return { message: 'ok' }
  })

  // Versão JWT para UI interna
  app.post('/integrations/leave-group-jwt', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { session_id, group_id } = req.body as { session_id?: string; group_id?: string }
    if (!session_id || !group_id) return reply.status(400).send({ error: 'session_id e group_id são obrigatórios' })
    await baileysService.leaveGroup(session_id, group_id)
    return { message: 'ok' }
  })

  // ===== Scraper interno (JWT) -> busca fontes, extrai links e enfileira joins =====
  app.post('/integrations/scrape-and-join', { preHandler: [app.authenticate] }, async (req, reply) => {
    const {
      session_ids,
      sources,
      user_agent,
      per_source_limit,
      global_limit,
      chunk_size,
      max_per_session_day,
      start_time,
      end_time,
      blacklist_domains,
    } = (req.body || {}) as {
      session_ids?: string[]
      sources?: string[] | string
      user_agent?: string
      per_source_limit?: number
      global_limit?: number
      chunk_size?: number
      max_per_session_day?: number
      start_time?: string | null
      end_time?: string | null
      blacklist_domains?: string[]
    }

    const sessions = Array.isArray(session_ids) ? session_ids.filter(Boolean) : []
    if (sessions.length === 0) return reply.status(400).send({ error: 'session_ids obrigatório (array)' })

    const srcs: string[] = Array.isArray(sources)
      ? sources.filter(Boolean)
      : typeof sources === 'string'
        ? sources.split(/\r?\n|,|;/).map((s) => s.trim()).filter(Boolean)
        : []
    if (srcs.length === 0) return reply.status(400).send({ error: 'sources vazio' })

    const ua = user_agent && user_agent.trim().length > 0
      ? user_agent
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
    const perLimit = Math.max(0, Math.trunc(Number(per_source_limit) || 0))
    const globLimit = Math.max(0, Math.trunc(Number(global_limit) || 0))
    const csize = Math.max(1, Math.trunc(Number(chunk_size) || 50))
    const bl = new Set((blacklist_domains || []).map((d) => String(d).toLowerCase()))

    const WAREG = /https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/g
    const host = (u: string) => {
      try { return new URL(u).hostname.toLowerCase() } catch { return '' }
    }

    let allLinks: string[] = []
    const perSource: { url: string; found?: number; error?: string }[] = []

    for (const url of srcs) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': ua } })
        const text = await res.text()
        let links = Array.from(new Set(text.match(WAREG) || []))
        links = links.filter((l) => !bl.has(host(l)))
        if (perLimit > 0 && links.length > perLimit) links = links.slice(0, perLimit)
        allLinks.push(...links)
        perSource.push({ url, found: links.length })
      } catch (err) {
        perSource.push({ url, error: String(err) })
      }
    }

    // Dedup & limits
    allLinks = Array.from(new Set(allLinks))
    if (globLimit > 0 && allLinks.length > globLimit) allLinks = allLinks.slice(0, globLimit)

    // Chunk e enfileira
    const chunks: string[][] = []
    for (let i = 0; i < allLinks.length; i += csize) {
      chunks.push(allLinks.slice(i, i + csize))
    }

    let queued = 0
    for (const batch of chunks) {
      await groupJoinQueue.add({
        sessionIds: sessions,
        inviteCodes: batch,
        maxPerSessionDay: Math.trunc(Number(max_per_session_day) || 0),
        startTime: start_time || null,
        endTime: end_time || null,
        source: 'scraper',
      })
      queued += batch.length
    }

    return { total_found: allLinks.length, queued, sources: perSource, sessions: sessions.length, chunk_size: csize }
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
