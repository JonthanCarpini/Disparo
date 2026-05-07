import Bull from 'bull'
import { v4 as uuidv4 } from 'uuid'
import { query, queryOne } from '../lib/db'
import { logger } from '../lib/logger'
import { baileysService } from '../services/BaileysService'

export interface GroupJoinJob {
  sessionIds: string[]
  inviteCodes: string[]
  maxPerSessionDay?: number
  startTime?: string | null
  endTime?: string | null
  source?: string
}

export let groupJoinQueue: Bull.Queue<GroupJoinJob>

export function initGroupJoinQueue(redisUrl: string) {
  groupJoinQueue = new Bull<GroupJoinJob>('group-join-queue', {
    redis: redisUrl,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  })

  groupJoinQueue.process(async (job) => {
    await processJoins(job.data)
  })

  logger.info('GroupJoinQueue inicializada')
}

function isWithinTimeWindow(startTime?: string | null, endTime?: string | null): boolean {
  if (!startTime || !endTime) return true
  const now = new Date()
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  if (startMins <= endMins) return nowMins >= startMins && nowMins < endMins
  return nowMins >= startMins || nowMins < endMins
}

async function getTodayCount(sessionId: string): Promise<number> {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM group_joins WHERE session_id = ? AND status = 'joined' AND DATE(created_at) = CURDATE()`,
    [sessionId],
  )
  return row?.c || 0
}

function extractInviteCode(linkOrCode: string): string | null {
  const s = linkOrCode.trim()
  const m = s.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]{5,})/i)
  if (m) return m[1]
  if (/^[A-Za-z0-9_-]{5,}$/.test(s)) return s
  return null
}

async function processJoins(payload: GroupJoinJob) {
  const { sessionIds, inviteCodes, maxPerSessionDay = 0, startTime = null, endTime = null, source = 'scraper' } = payload

  const liveSessions = sessionIds.filter((s) => baileysService.isConnected(s))
  if (liveSessions.length === 0) throw new Error('Nenhuma sessão conectada para join em grupos')

  const codes = Array.from(new Set(inviteCodes.map(extractInviteCode).filter((x): x is string => !!x)))
  if (codes.length === 0) return

  let sessionIndex = 0
  for (const code of codes) {
    // Kill switch (pausa global)
    const paused = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key` = 'group_join_paused'")
    if (paused?.value === 'true') {
      logger.warn('Processo pausado por configuração (group_join_paused=true)')
      break
    }
    if (!isWithinTimeWindow(startTime, endTime)) {
      logger.info({ code }, 'Fora da janela de horário — interrompendo')
      break
    }

    const sessionId = liveSessions[sessionIndex % liveSessions.length]
    sessionIndex++

    // Limite por dia/sessão
    if (maxPerSessionDay > 0) {
      const today = await getTodayCount(sessionId)
      if (today >= maxPerSessionDay) {
        logger.info({ sessionId, today, maxPerSessionDay }, 'Limite diário por sessão atingido — pulando')
        await query(
          `INSERT IGNORE INTO group_joins (id, source, invite_link, invite_code, session_id, status)
           VALUES (?, ?, ?, ?, ?, 'skipped')`,
          [uuidv4(), source, code, code, sessionId],
        )
        continue
      }
    }

    // Dedup por sessão+código
    const exists = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM group_joins WHERE invite_code = ? AND session_id = ? LIMIT 1',
      [code, sessionId],
    )
    if (exists) {
      logger.info({ code, sessionId }, 'Convite já processado — pulando')
      continue
    }

    const id = uuidv4()
    await query(
      `INSERT INTO group_joins (id, source, invite_link, invite_code, session_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, source, code, code, sessionId],
    )

    try {
      const res: any = await baileysService.joinGroupByInvite(sessionId, code)
      await query(
        `UPDATE group_joins SET status = 'joined', group_id = ?, group_name = ? WHERE id = ?`,
        [res?.groupId || null, (res?.subject as string) || null, id],
      )
      logger.info({ code, sessionId, groupId: res.groupId }, 'Join em grupo concluído')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      await query(
        `UPDATE group_joins SET status = 'failed', error = ? WHERE id = ?`,
        [errorMsg, id],
      )
      logger.warn({ err, code, sessionId }, 'Falha ao entrar no grupo')
    }

    // Pequeno intervalo para evitar flood
    await new Promise((r) => setTimeout(r, 2000))
  }
}
