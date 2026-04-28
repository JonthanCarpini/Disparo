import { FastifyInstance } from 'fastify'
import { findUser, comparePassword, signToken, hashPassword } from '../lib/auth'
import { query } from '../lib/db'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }

    const user = await findUser(username)
    if (!user) {
      return reply.status(401).send({ error: 'Credenciais inválidas' })
    }

    const valid = await comparePassword(password, user.password)
    if (!valid) {
      return reply.status(401).send({ error: 'Credenciais inválidas' })
    }

    const token = signToken({ id: user.id, username: user.username })
    return { token, username: user.username }
  })

  app.put('/auth/password', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const user = req.user as { id: number; username: string }
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string
      newPassword: string
    }

    const found = await findUser(user.username)
    if (!found) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const valid = await comparePassword(currentPassword, found.password)
    if (!valid) return reply.status(401).send({ error: 'Senha atual incorreta' })

    const hashed = await hashPassword(newPassword)
    await query('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id])
    return { message: 'Senha atualizada com sucesso' }
  })

  app.put('/auth/username', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['newUsername', 'password'],
        properties: {
          newUsername: { type: 'string', minLength: 3 },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const user = req.user as { id: number; username: string }
    const { newUsername, password } = req.body as { newUsername: string; password: string }

    const found = await findUser(user.username)
    if (!found) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const valid = await comparePassword(password, found.password)
    if (!valid) return reply.status(401).send({ error: 'Senha incorreta' })

    const existing = await findUser(newUsername)
    if (existing && existing.id !== user.id) {
      return reply.status(409).send({ error: 'Username já em uso' })
    }

    await query('UPDATE users SET username = ? WHERE id = ?', [newUsername, user.id])
    return { message: 'Username atualizado com sucesso' }
  })
}
