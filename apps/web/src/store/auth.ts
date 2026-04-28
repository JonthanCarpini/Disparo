import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'

interface AuthState {
  token: string | null
  username: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      username: null,
      isAuthenticated: false,

      login: async (username, password) => {
        const res = await api.post('/auth/login', { username, password })
        const { token, username: user } = res.data
        localStorage.setItem('disparo_token', token)
        set({ token, username: user, isAuthenticated: true })
      },

      logout: () => {
        localStorage.removeItem('disparo_token')
        set({ token: null, username: null, isAuthenticated: false })
      },
    }),
    {
      name: 'disparo-auth',
      partialize: (state) => ({ token: state.token, username: state.username, isAuthenticated: state.isAuthenticated }),
    },
  ),
)
