import mysql from 'mysql2/promise'
import { logger } from './logger'

let pool: mysql.Pool | null = null

export function getDb(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'mysql',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'disparo',
      password: process.env.DB_PASS || 'Disparo@2026',
      database: process.env.DB_NAME || 'disparo_whats',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: '-03:00',
    })
    logger.info('MySQL pool criado')
  }
  return pool
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = unknown>(sql: string, values?: any[]): Promise<T[]> {
  const db = getDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (db as any).execute(sql, values)
  return rows as T[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryOne<T = unknown>(sql: string, values?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, values)
  return rows[0] ?? null
}
