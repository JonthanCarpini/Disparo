import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query, queryOne } from './db'

const JWT_SECRET = process.env.JWT_SECRET || 'disparo-jwt-secret-change-me-2026!!'

export interface AuthUser {
  id: number
  username: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser
}

export async function findUser(username: string): Promise<(AuthUser & { password: string }) | null> {
  return queryOne<AuthUser & { password: string }>(
    'SELECT id, username, password FROM users WHERE username = ?',
    [username],
  )
}

export async function ensureDefaultUser() {
  const existing = await query('SELECT id FROM users LIMIT 1')
  if (existing.length === 0) {
    const hashed = await hashPassword(process.env.ADMIN_PASSWORD || 'admin123')
    await query('INSERT INTO users (username, password) VALUES (?, ?)', [
      process.env.ADMIN_USERNAME || 'admin',
      hashed,
    ])
  }
}
