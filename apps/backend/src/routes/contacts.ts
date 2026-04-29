import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import { query, queryOne } from '../lib/db'
import { baileysService } from '../services/BaileysService'

export async function contactsRoutes(app: FastifyInstance) {
  app.get('/contacts/lists', { preHandler: [app.authenticate] }, async () => {
    return query(
      'SELECT id, name, source, total, created_at FROM contact_lists ORDER BY created_at DESC',
    )
  })

  app.get('/contacts/lists/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const list = await queryOne('SELECT * FROM contact_lists WHERE id = ?', [id])
    if (!list) return reply.status(404).send({ error: 'Lista não encontrada' })
    const contacts = await query(
      'SELECT id, phone, name, extra_data FROM contacts WHERE list_id = ? ORDER BY created_at',
      [id],
    )
    return { list, contacts }
  })

  app.post('/contacts/lists/:id/verify-numbers', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { sessionId } = req.body as { sessionId: string }

    if (!baileysService.isConnected(sessionId)) {
      return reply.status(400).send({ error: 'Sessão não conectada' })
    }

    const list = await queryOne('SELECT id FROM contact_lists WHERE id = ?', [id])
    if (!list) return reply.status(404).send({ error: 'Lista não encontrada' })

    const contacts = await query<{ id: string; phone: string; jid: string | null }>(
      'SELECT id, phone, jid FROM contacts WHERE list_id = ? AND wa_exists IS NULL',
      [id],
    )

    if (contacts.length === 0) {
      return { message: 'Todos os contatos já foram verificados', verified: 0 }
    }

    const resultMap = await baileysService.verifyContacts(sessionId, contacts)

    let valid = 0
    let invalid = 0
    const BATCH = 200
    const ids = contacts.map((c) => c.id)
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = contacts.slice(i, i + BATCH)
      for (const c of slice) {
        const exists = resultMap.get(c.phone) ? 1 : 0
        if (exists) valid++; else invalid++
        await query(
          'UPDATE contacts SET wa_exists = ?, verified_at = NOW() WHERE id = ?',
          [exists, c.id],
        )
      }
    }

    return { total: contacts.length, valid, invalid }
  })

  app.delete('/contacts/lists/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const list = await queryOne('SELECT id FROM contact_lists WHERE id = ?', [id])
    if (!list) return reply.status(404).send({ error: 'Lista não encontrada' })
    await query('DELETE FROM contact_lists WHERE id = ?', [id])
    return { message: 'Lista removida' }
  })

  app.post('/contacts/import', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'Arquivo CSV obrigatório' })

    const { name } = req.query as { name?: string }
    const buffer = await data.toBuffer()
    const content = buffer.toString('utf-8')

    let records: Record<string, string>[]
    try {
      records = parse(content, { columns: true, skip_empty_lines: true, trim: true })
    } catch {
      return reply.status(400).send({ error: 'CSV inválido' })
    }

    const listId = uuidv4()
    const listName = name || data.filename?.replace('.csv', '') || 'Lista importada'

    await query(
      "INSERT INTO contact_lists (id, name, source, total) VALUES (?, ?, 'csv_import', ?)",
      [listId, listName, records.length],
    )

    const phoneFields = ['phone', 'telefone', 'numero', 'number', 'celular', 'whatsapp']
    const nameFields = ['name', 'nome', 'contato', 'contact']

    for (const row of records) {
      const phoneField = phoneFields.find((f) => row[f] !== undefined)
      const nameField = nameFields.find((f) => row[f] !== undefined)

      if (!phoneField) continue

      const phone = normalizePhone(row[phoneField])
      if (!phone) continue

      const contactName = nameField ? row[nameField] : null
      const id = uuidv4()

      await query(
        'INSERT INTO contacts (id, list_id, phone, name, extra_data) VALUES (?, ?, ?, ?, ?)',
        [id, listId, phone, contactName, JSON.stringify(row)],
      )
    }

    return { listId, name: listName, total: records.length }
  })

  app.post('/contacts/extract-group', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { sessionId, groupId, listName } = req.body as {
      sessionId: string
      groupId: string
      listName: string
    }

    if (!baileysService.isConnected(sessionId)) {
      return reply.status(400).send({ error: 'Sessão não conectada' })
    }

    const participants = await baileysService.getGroupParticipants(sessionId, groupId)

    if (participants.length === 0) {
      return reply.status(422).send({
        error: 'Nenhum participante encontrado neste grupo.',
      })
    }

    const listId = uuidv4()
    await query(
      "INSERT INTO contact_lists (id, name, source, total) VALUES (?, ?, 'group_extract', ?)",
      [listId, listName, participants.length],
    )

    await bulkInsertContacts(listId, participants)

    return { listId, name: listName, total: participants.length }
  })

  app.post('/contacts/extract-contacts', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { sessionId, listName } = req.body as { sessionId: string; listName: string }

    if (!baileysService.isConnected(sessionId)) {
      return reply.status(400).send({ error: 'Sessão não conectada' })
    }

    const contacts = await baileysService.getContacts(sessionId)

    const listId = uuidv4()
    await query(
      "INSERT INTO contact_lists (id, name, source, total) VALUES (?, ?, 'contact_extract', ?)",
      [listId, listName, contacts.length],
    )

    await bulkInsertContacts(listId, contacts.map((c) => ({ ...c, jid: `${c.phone}@s.whatsapp.net` })))

    return { listId, name: listName, total: contacts.length }
  })

  app.get('/contacts/lists/:id/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const list = await queryOne<{ name: string }>('SELECT name FROM contact_lists WHERE id = ?', [id])
    const contacts = await query<{ phone: string; name: string }>(
      'SELECT phone, name FROM contacts WHERE list_id = ? ORDER BY created_at',
      [id],
    )

    const cleaned = contacts.map((c) => ({
      phone: String(c.phone || '').split(':')[0],
      name: c.name || '',
    }))

    const csv = stringify(cleaned, {
      header: true,
      columns: ['phone', 'name'],
      delimiter: ';',
    })

    const BOM = '\uFEFF'
    const filename = (list?.name || id).replace(/[^a-zA-Z0-9_\-]/g, '_')
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}.csv"`)
    return reply.send(BOM + csv)
  })
}

async function bulkInsertContacts(
  listId: string,
  contacts: { phone: string; name: string; jid?: string }[],
): Promise<void> {
  if (contacts.length === 0) return
  const BATCH = 500
  for (let i = 0; i < contacts.length; i += BATCH) {
    const slice = contacts.slice(i, i + BATCH)
    const placeholders = slice.map(() => '(?, ?, ?, ?, ?)').join(', ')
    const values: string[] = []
    for (const c of slice) {
      values.push(uuidv4(), listId, c.phone, c.jid || `${c.phone}@s.whatsapp.net`, c.name)
    }
    await query(
      `INSERT INTO contacts (id, list_id, phone, jid, name) VALUES ${placeholders}`,
      values,
    )
  }
}

function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.split(':')[0].split('@')[0]
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  if (!digits.startsWith('55') && digits.length <= 11) {
    return `55${digits}`
  }
  return digits
}
