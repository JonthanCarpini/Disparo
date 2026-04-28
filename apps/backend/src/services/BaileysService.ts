import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  BaileysEventMap,
  proto,
  downloadMediaMessage,
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

class BaileysService {
  private sockets: Map<string, WASocket> = new Map()
  private qrCallbacks: Set<QRCallback> = new Set()
  private statusCallbacks: Set<StatusCallback> = new Set()

  onQR(cb: QRCallback) {
    this.qrCallbacks.add(cb)
    return () => this.qrCallbacks.delete(cb)
  }

  onStatus(cb: StatusCallback) {
    this.statusCallbacks.add(cb)
    return () => this.statusCallbacks.delete(cb)
  }

  private emitQR(sessionId: string, qr: string) {
    this.qrCallbacks.forEach((cb) => cb(sessionId, qr))
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

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ module: 'baileys', sessionId }) as never,
      browser: ['Disparo WA', 'Chrome', '110.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 15000,
    })

    this.sockets.set(sessionId, sock)

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        const QRCode = await import('qrcode')
        const qrDataUrl = await QRCode.toDataURL(qr)
        this.emitQR(sessionId, qrDataUrl)
      }

      if (connection === 'open') {
        const phone = sock.user?.id?.split(':')[0] ?? null
        await query('UPDATE whatsapp_sessions SET status = ?, phone = ? WHERE id = ?', [
          'connected',
          phone,
          sessionId,
        ])
        this.emitStatus(sessionId, 'connected', phone ?? undefined)
        logger.info({ sessionId, phone }, 'WhatsApp conectado')
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
          await query('UPDATE whatsapp_sessions SET status = ? WHERE id = ?', [
            'disconnected',
            sessionId,
          ])
          this.emitStatus(sessionId, 'disconnected')
          logger.info({ sessionId, reason }, 'Sessão desconectada, reconectando em 5s...')
          setTimeout(() => this.connect(sessionId), 5000)
        }
      }
    })
  }

  async disconnect(sessionId: string) {
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
  ): Promise<{ phone: string; name: string }[]> {
    const sock = this.sockets.get(sessionId)
    if (!sock) throw new Error(`Sessão ${sessionId} não conectada`)
    const meta = await sock.groupMetadata(groupId)
    return meta.participants.map((p) => ({
      phone: p.id.split('@')[0],
      name: p.id.split('@')[0],
    }))
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
