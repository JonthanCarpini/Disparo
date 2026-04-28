'use client'

import { useState } from 'react'
import { Lock, User, Save, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'

export default function SettingsPage() {
  const { username } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [userForm, setUserForm] = useState({ currentPassword: '', newUsername: '' })

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwForm.newPassword !== pwForm.confirmPassword) return toast.error('As senhas não coincidem')
    if (pwForm.newPassword.length < 6) return toast.error('Senha mínima: 6 caracteres')
    setLoading(true)
    try {
      await api.put('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      })
      toast.success('Senha alterada com sucesso!')
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch {
      toast.error('Senha atual incorreta')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userForm.newUsername.trim()) return toast.error('Informe o novo usuário')
    setLoading(true)
    try {
      await api.put('/auth/change-username', {
        currentPassword: userForm.currentPassword,
        newUsername: userForm.newUsername,
      })
      toast.success('Usuário alterado! Faça login novamente.')
      setUserForm({ currentPassword: '', newUsername: '' })
    } catch {
      toast.error('Senha atual incorreta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Configurações</h2>
        <p className="text-muted-foreground mt-1">Gerencie sua conta e segurança</p>
      </div>

      <div className="space-y-6">
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="bg-muted p-2.5 rounded-xl">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Alterar Usuário</h3>
              <p className="text-xs text-muted-foreground">Usuário atual: <span className="text-primary">{username}</span></p>
            </div>
          </div>
          <form onSubmit={handleChangeUsername} className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Senha atual</label>
              <input
                type="password"
                value={userForm.currentPassword}
                onChange={(e) => setUserForm({ ...userForm, currentPassword: e.target.value })}
                required
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Novo usuário</label>
              <input
                type="text"
                value={userForm.newUsername}
                onChange={(e) => setUserForm({ ...userForm, newUsername: e.target.value })}
                placeholder="Ex: admin2024"
                required
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar Usuário
            </button>
          </form>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="bg-muted p-2.5 rounded-xl">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Alterar Senha</h3>
              <p className="text-xs text-muted-foreground">Use uma senha forte com pelo menos 6 caracteres</p>
            </div>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Senha atual</label>
              <input
                type="password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                required
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Nova senha</label>
              <input
                type="password"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                placeholder="Mínimo 6 caracteres"
                required
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Confirmar nova senha</label>
              <input
                type="password"
                value={pwForm.confirmPassword}
                onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                placeholder="Repita a nova senha"
                required
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Alterar Senha
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
