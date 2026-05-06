import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestWaWebVersion,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import path from 'path'
import fs from 'fs'
import { query } from '../lib/db'
import { logger } from '../lib/logger'

export interface SessionInfo {
  id: string
  name: string
  phone: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'banned'
}

type QRCallback = (sessionId: string, qr: string) => void
type StatusCallback = (sessionId: string, status: SessionInfo['status'], phone?: string) => void

const SESSIONS_DIR = process.env.SESSIONS_DIR || '/app/data/sessions'
const MAX_RETRIES = 5

class BaileysService {
  private sockets: Map<string, WASocket> = new Map()
  private qrCallbacks: Set<QRCallback> = new Set()
  private statusCallbacks: Set<StatusCallback> = new Set()
  private qrCache: Map<string, string> = new Map()
  private retryCount: Map<string, number> = new Map()
  private lidToPhone: Map<string, Map<string, string>> = new Map()

  onQR(cb: QRCallback) {
    this.qrCallbacks.add(cb)
    return () => this.qrCallbacks.delete(cb)
  }

  onStatus(cb: StatusCallback) {
    this.statusCallbacks.add(cb)
    return () => this.statusCallbacks.delete(cb)
  }

  private emitQR(sessionId: string, qr: string) {
    this.qrCache.set(sessionId, qr)
    this.qrCallbacks.forEach((cb) => cb(sessionId, qr))
  }

  getQR(sessionId: string): string | null {
    return this.qrCache.get(sessionId) ?? null
  }

  getLidMapSize(sessionId: string): number {
    return this.lidToPhone.get(sessionId)?.size ?? 0
  }

  async forceResync(sessionId: string): Promise<{ success: boolean; lidMapSize: number; error?: string }> {
    const sock = this.sockets.get(sessionId)
    if (!sock) return { success: false, lidMapSize: 0, error: 'Sessão não conectada' }
    try {
      const sockAny = sock as unknown as { resyncAppState?: (collections: string[], isInitialSync: boolean) => Promise<void> }
      if (!sockAny.resyncAppState) return { success: false, lidMapSize: 0, error: 'resyncAppState não disponível' }
      await sockAny.resyncAppState(['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'], true)
      const lidMapSize = this.lidToPhone.get(sessionId)?.size ?? 0
      return { success: true, lidMapSize }
    } catch (err) {
      return { success: false, lidMapSize: this.lidToPhone.get(sessionId)?.size ?? 0, error: String(err) }
    }
  }

  private emitStatus(sessionId: string, status: SessionInfo['status'], phone?: string) {
    this.statusCallbacks.forEach((cb) => cb(sessionId, status, phone))
  }

  private sessionDir(sessionId: string): string {
    return path.join(SESSIONS_DIR, sessionId)
  }

  async loadAllSessions() {
    const sessions = await query<{ id: string; name: string }>(
      "SELECT id, name FROM whatsapp_sessions WHERE status != 'banned'",
    )
    for (const s of sessions) {
      await this.connect(s.id).catch((err) =>
        logger.warn({ err, sessionId: s.id }, 'Falha ao reconectar sessão'),
      )
    }
  }

  async connect(sessionId: string) {
    if (this.sockets.has(sessionId)) return

    const dir = this.sessionDir(sessionId)
    fs.mkdirSync(dir, { recursive: true })

    const { state, saveCreds } = await useMultiFileAuthState(dir)

    await query('UPDATE whatsapp_sessions SET status = ? WHERE id = ?', ['connecting', sessionId])
    this.emitStatus(sessionId, 'connecting')

    let waVersion: [number, number, number] = [2, 3000, 1023223821]
    try {
      const { version } = await fetchLatestWaWebVersion({})
      waVersion = version
    } catch {
      logger.warn({ sessionId }, 'Falha ao buscar versão WA, usando padrão')
    }

    const sock = makeWASocket({
      auth: state,
      version: waVersion,
      printQRInTerminal: false,
      logger: logger.child({ module: 'baileys', sessionId }) as never,
      browser: ['Ubuntu', 'Chrome', '121.0.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 3,
      qrTimeout: 60000,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      markOnlineOnConnect: true,
    })

    this.sockets.set(sessionId, sock)

    sock.ev.on('creds.update', saveCreds)

    if (!this.lidToPhone.has(sessionId)) {
      this.lidToPhone.set(sessionId, new Map())
    }
    const lidMap = this.lidToPhone.get(sessionId)!

    const lidMapPath = path.join(dir, 'lid-map.json')
    try {
      if (fs.existsSync(lidMapPath)) {
        const saved = JSON.parse(fs.readFileSync(lidMapPath, 'utf-8'))
        for (const [k, v] of Object.entries(saved)) {
          lidMap.set(k, String(v))
        }
        logger.info({ sessionId, loaded: lidMap.size }, 'lidMap carregado do disco')
      }
    } catch (err) {
      logger.warn({ sessionId, err }, 'Falha ao carregar lidMap do disco')
    }

    const persistLidMap = () => {
      try {
        const obj: Record<string, string> = {}
        lidMap.forEach((v, k) => { obj[k] = v })
        fs.writeFileSync(lidMapPath, JSON.stringify(obj))
      } catch (err) {
        logger.warn({ sessionId, err }, 'Falha ao persistir lidMap')
      }
    }

    setInterval(persistLidMap, 30000)

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) {
        const jid = String(c.id || '')
        const lid = String((c as unknown as Record<string, unknown>).lid || '')
        if (lid && jid.endsWith('@s.whatsapp.net')) {
          const phone = jid.split('@')[0].split(':')[0]
          if (/^\d{8,15}$/.test(phone)) {
            lidMap.set(lid.split('@')[0], phone)
          }
        }
        if (jid.endsWith('@s.whatsapp.net')) {
          const phone = jid.split('@')[0].split(':')[0]
          if (/^\d{8,15}$/.test(phone)) {
            lidMap.set(phone, phone)
          }
        }
      }
      logger.debug({ sessionId, lidMapSize: lidMap.size }, 'lidMap atualizado')
    })

    sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) {
        const jid = String(u.id || '')
        const uAny = u as unknown as Record<string, unknown>
        const lid = String(uAny.lid || '')
        if (lid && jid.endsWith('@s.whatsapp.net')) {
          const phone = jid.split('@')[0].split(':')[0]
          if (/^\d{8,15}$/.test(phone)) {
            lidMap.set(lid.split('@')[0], phone)
          }
        }
      }
    })

    sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        const jid = String(chat.id || '')
        const chatAny = chat as unknown as Record<string, unknown>
        const lid = String(chatAny.lid || chatAny.lidJid || '')
        if (lid && jid.endsWith('@s.whatsapp.net')) {
          const phone = jid.split('@')[0].split(':')[0]
          if (/^\d{8,15}$/.test(phone)) {
            lidMap.set(lid.split('@')[0], phone)
          }
        }
      }
    })

    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        const from = String(msg.key?.remoteJid || '')
        const participant = String(msg.key?.participant || '')
        const msgAny = msg as unknown as Record<string, unknown>
        const pushName = String(msgAny.pushName || '')
        
        for (const jid of [from, participant]) {
          if (jid.endsWith('@s.whatsapp.net')) {
            const phone = jid.split('@')[0].split(':')[0]
            if (/^\d{8,15}$/.test(phone) && pushName) {
              lidMap.set(phone, phone)
            }
          }
        }
      }
    })

    sock.ev.on('messaging-history.set', (data) => {
      const dataAny = data as unknown as {
        contacts?: Array<{ id?: string; lid?: string; name?: string; notify?: string }>
        chats?: Array<{ id?: string; lid?: string; name?: string }>
      }
      let added = 0
      if (dataAny.contacts) {
        for (const c of dataAny.contacts) {
          const jid = String(c.id || '')
          const lid = String(c.lid || '')
          if (lid && jid.endsWith('@s.whatsapp.net')) {
            const phone = jid.split('@')[0].split(':')[0]
            if (/^\d{8,15}$/.test(phone)) {
              const lidNum = lid.split('@')[0]
              lidMap.set(lidNum, phone)
              added++
            }
          }
        }
      }
      if (dataAny.chats) {
        for (const chat of dataAny.chats) {
          const jid = String(chat.id || '')
          const lid = String(chat.lid || '')
          if (lid && jid.endsWith('@s.whatsapp.net')) {
            const phone = jid.split('@')[0].split(':')[0]
            if (/^\d{8,15}$/.test(phone)) {
              lidMap.set(lid.split('@')[0], phone)
              added++
            }
          }
        }
      }
      logger.info({ sessionId, added, totalMap: lidMap.size, contacts: dataAny.contacts?.length || 0, chats: dataAny.chats?.length || 0 }, 'messaging-history.set processado')
    })

    sock.ev.on('chats.update', (updates) => {
      for (const u of updates) {
        const jid = String(u.id || '')
        const uAny = u as unknown as Record<string, unknown>
        const lid = String(uAny.lid || uAny.lidJid || '')
        if (lid && jid.endsWith('@s.whatsapp.net')) {
          const phone = jid.split('@')[0].split(':')[0]
          if (/^\d{8,15}$/.test(phone)) {
            lidMap.set(lid.split('@')[0], phone)
          }
        }
      }
    })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        const QRCode = await import('qrcode')
        const qrDataUrl = await QRCode.toDataURL(qr)
        this.emitQR(sessionId, qrDataUrl)
      }

      if (connection === 'open') {
        const phone = sock.user?.id?.split(':')[0] ?? null
        this.retryCount.delete(sessionId)
        this.qrCache.delete(sessionId)
        await query('UPDATE whatsapp_sessions SET status = ?, phone = ? WHERE id = ?', [
          'connected',
          phone,
          sessionId,
        ])
        this.emitStatus(sessionId, 'connected', phone ?? undefined)
        logger.info({ sessionId, phone }, 'WhatsApp conectado')

        setTimeout(async () => {
          try {
            const sockAny = sock as unknown as { resyncAppState?: (collections: string[], isInitialSync: boolean) => Promise<void> }
            if (sockAny.resyncAppState) {
              logger.info({ sessionId }, 'Forçando resync de contatos via resyncAppState')
              await sockAny.resyncAppState(['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'], true)
              logger.info({ sessionId, lidMapSize: lidMap.size }, 'resyncAppState concluído')
            }
          } catch (err) {
            logger.warn({ sessionId, err: String(err) }, 'Falha no resyncAppState')
          }
        }, 3000)
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
        const banned =
          reason === DisconnectReason.loggedOut || reason === DisconnectReason.forbidden

        this.sockets.delete(sessionId)

        if (banned) {
          await query('UPDATE whatsapp_sessions SET status = ? WHERE id = ?', ['banned', sessionId])
          this.emitStatus(sessionId, 'banned')
          logger.warn({ sessionId, reason }, 'Sessão banida/deslogada')
        } else {
          const retries = (this.retryCount.get(sessionId) ?? 0) + 1
          this.retryCount.set(sessionId, retries)
          const delay = Math.min(retries * 5000, 30000)
          await query('UPDATE whatsapp_sessions SET status = ? WHERE id = ?', [
            'disconnected',
            sessionId,
          ])
          this.emitStatus(sessionId, 'disconnected')
          logger.info({ sessionId, reason, retries, delay }, 'Sessão desconectada, reconectando...')
          if (retries <= MAX_RETRIES) {
            setTimeout(() => this.connect(sessionId), delay)
          } else {
            logger.warn({ sessionId }, 'Máximo de tentativas atingido, aguardando reconexão manual')
            this.retryCount.delete(sessionId)
          }
        }
      }
    })
  }

  async disconnect(sessionId: string) {
    this.retryCount.delete(sessionId)
    this.qrCache.delete(sessionId)
    const sock = this.sockets.get(sessionId)
    if (sock) {
      await sock.logout().catch(() => null)
      this.sockets.delete(sessionId)
    }
    const dir = this.sessionDir(sessionId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
    await query('UPDATE whatsapp_sessions SET status = ?, phone = NULL WHERE id = ?', [
      'disconnected',
      sessionId,
    ])
    this.emitStatus(sessionId, 'disconnected')
  }

  getSocket(sessionId: string): WASocket | null {
    return this.sockets.get(sessionId) ?? null
  }

  isConnected(sessionId: string): boolean {
    return this.sockets.has(sessionId)
  }

  getConnectedSessions(): string[] {
    return Array.from(this.sockets.keys())
  }

  async verifyContacts(
    sessionId: string,
    contacts: { phone: string; jid: string | null }[],
  ): Promise<Map<string, boolean>> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)

    const result = new Map<string, boolean>()

    const lidContacts = contacts.filter((c) => c.jid && c.jid.endsWith('@lid'))
    for (const c of lidContacts) {
      result.set(c.phone, true)
    }

    const phoneContacts = contacts.filter((c) => !c.jid || !c.jid.endsWith('@lid'))
    if (phoneContacts.length === 0) return result

    const BATCH = 50
    for (let i = 0; i < phoneContacts.length; i += BATCH) {
      const slice = phoneContacts.slice(i, i + BATCH)
      const phones = slice.map((c) => c.phone)
      try {
        const checks = await sock.onWhatsApp(...phones)
        const existsMap = new Map<string, boolean>()
        for (const r of checks || []) {
          const num = String(r.jid || '').split('@')[0].split(':')[0]
          existsMap.set(num, !!r.exists)
        }
        for (const c of slice) {
          result.set(c.phone, existsMap.get(c.phone) ?? false)
        }
      } catch (err) {
        logger.warn({ sessionId, err: String(err) }, 'Falha em verifyContacts batch')
        for (const c of slice) {
          result.set(c.phone, false)
        }
      }
      if (i + BATCH < phoneContacts.length) {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    return result
  }

  async joinGroupByInvite(sessionId: string, inviteCode: string): Promise<{ groupId: string; subject?: string }> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    // Baileys: groupAcceptInvite(inviteCode)
    // Retorna geralmente { gid } ou metadata após entrar
    const res: any = await (sock as any).groupAcceptInvite(inviteCode)
    // Alguns retornos trazem { gid }, outros um jid direto
    const groupId: string = typeof res === 'string' ? res : (res?.gid || res?.groupId || res?.id)
    try {
      const meta = await sock.groupMetadata(groupId)
      return { groupId, subject: meta?.subject }
    } catch {
      return { groupId }
    }
  }

  async leaveGroup(sessionId: string, groupId: string): Promise<void> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    await (sock as any).groupLeave(groupId)
  }

  async sendText(sessionId: string, phone: string, message: string): Promise<void> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
    await sock.sendMessage(jid, { text: message })
  }

  async sendImage(
    sessionId: string,
    phone: string,
    imagePath: string,
    caption?: string,
  ): Promise<void> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
    const buffer = fs.readFileSync(imagePath)
    await sock.sendMessage(jid, { image: buffer, caption: caption || '' })
  }

  async sendAudio(sessionId: string, phone: string, audioPath: string): Promise<void> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
    const buffer = fs.readFileSync(audioPath)
    await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4', ptt: true })
  }

  async sendImageWithAudio(
    sessionId: string,
    phone: string,
    imagePath: string,
    audioPath: string,
    caption?: string,
  ): Promise<void> {
    await this.sendImage(sessionId, phone, imagePath, caption)
    await new Promise((r) => setTimeout(r, 1500))
    await this.sendAudio(sessionId, phone, audioPath)
  }

  async getGroups(sessionId: string): Promise<{ id: string; name: string; size: number }[]> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const groups = await sock.groupFetchAllParticipating()
    return Object.values(groups).map((g) => ({
      id: g.id,
      name: g.subject,
      size: g.participants.length,
    }))
  }

  async getGroupParticipants(
    sessionId: string,
    groupId: string,
  ): Promise<{ phone: string; jid: string; name: string }[]> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const meta = await sock.groupMetadata(groupId)
    logger.info({ sessionId, groupId, total: meta.participants.length, sample: meta.participants.slice(0, 3).map(p => ({ id: p.id })) }, 'getGroupParticipants raw')

    const lidMap = this.lidToPhone.get(sessionId) || new Map<string, string>()
    const result: { phone: string; jid: string; name: string }[] = []

    let lidsResolved = 0
    let lidsAsIs = 0
    let regularCount = 0

    for (const p of meta.participants) {
      const jid = String(p.id || '')
      const pAny = p as unknown as Record<string, unknown>
      const rawName = String(pAny.pushName || pAny.notify || pAny.name || '')

      if (jid.endsWith('@s.whatsapp.net')) {
        const phone = jid.split('@')[0].split(':')[0]
        if (/^\d{8,15}$/.test(phone)) {
          result.push({ phone, jid, name: rawName || phone })
          regularCount++
        }
        continue
      }

      if (jid.endsWith('@lid')) {
        const lidNum = jid.split('@')[0]
        const mappedPhone = lidMap.get(lidNum)

        if (mappedPhone) {
          result.push({
            phone: mappedPhone,
            jid: `${mappedPhone}@s.whatsapp.net`,
            name: rawName || mappedPhone,
          })
          lidsResolved++
        } else {
          result.push({
            phone: lidNum,
            jid,
            name: rawName || lidNum,
          })
          lidsAsIs++
        }
      }
    }

    logger.info({ sessionId, groupId, extracted: result.length, regularCount, lidsResolved, lidsAsIs }, 'getGroupParticipants extracted')
    return result
  }

  async getContacts(sessionId: string): Promise<{ phone: string; name: string }[]> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const contacts = await sock.fetchStatus('@s.whatsapp.net').catch(() => null)
    const all = await (sock as never as { store?: { contacts: Record<string, { id: string; name?: string; notify?: string }> } })?.store?.contacts
    if (!all) return []
    return Object.values(all)
      .filter((c) => c.id && c.id.endsWith('@s.whatsapp.net') && !c.id.includes('-'))
      .map((c) => ({
        phone: c.id.split('@')[0],
        name: c.name || c.notify || c.id.split('@')[0],
      }))
  }
}

export const baileysService = new BaileysService()
