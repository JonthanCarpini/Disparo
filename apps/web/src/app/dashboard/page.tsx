'use client'

import { useEffect, useState } from 'react'
import { Send, Smartphone, Users, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'

interface Stats {
  sessions: { total: number; connected: number }
  campaigns: { total: number; running: number; completed: number }
  contacts: { lists: number }
  sent: { total: number; failed: number }
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentCampaigns, setRecentCampaigns] = useState<Campaign[]>([])

  interface Campaign {
    id: string
    name: string
    status: string
    sent: number
    total: number
    failed: number
    created_at: string
  }

  useEffect(() => {
    async function load() {
      try {
        const [sessionsRes, campaignsRes, contactsRes] = await Promise.all([
          api.get('/whatsapp/sessions'),
          api.get('/campaigns'),
          api.get('/contacts/lists'),
        ])

        const sessions = sessionsRes.data
        const campaigns: Campaign[] = campaignsRes.data
        const contacts = contactsRes.data

        setRecentCampaigns(campaigns.slice(0, 5))
        setStats({
          sessions: {
            total: sessions.length,
            connected: sessions.filter((s: { status: string }) => s.status === 'connected').length,
          },
          campaigns: {
            total: campaigns.length,
            running: campaigns.filter((c) => c.status === 'running').length,
            completed: campaigns.filter((c) => c.status === 'completed').length,
          },
          contacts: { lists: contacts.length },
          sent: {
            total: campaigns.reduce((a: number, c: Campaign) => a + (c.sent || 0), 0),
            failed: campaigns.reduce((a: number, c: Campaign) => a + (c.failed || 0), 0),
          },
        })
      } catch {
        /* silencioso */
      }
    }
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  const cards = [
    {
      label: 'Números Conectados',
      value: stats ? `${stats.sessions.connected}/${stats.sessions.total}` : '—',
      icon: Smartphone,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      label: 'Listas de Contatos',
      value: stats?.contacts.lists ?? '—',
      icon: Users,
      color: 'text-violet-400',
      bg: 'bg-violet-400/10',
    },
    {
      label: 'Mensagens Enviadas',
      value: stats?.sent.total ?? '—',
      icon: CheckCircle,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Campanhas Ativas',
      value: stats?.campaigns.running ?? '—',
      icon: TrendingUp,
      color: 'text-yellow-400',
      bg: 'bg-yellow-400/10',
    },
  ]

  const statusMap: Record<string, { label: string; class: string }> = {
    draft: { label: 'Rascunho', class: 'bg-muted text-muted-foreground' },
    scheduled: { label: 'Agendado', class: 'bg-blue-500/20 text-blue-400' },
    running: { label: 'Enviando', class: 'bg-yellow-500/20 text-yellow-400' },
    paused: { label: 'Pausado', class: 'bg-orange-500/20 text-orange-400' },
    completed: { label: 'Concluído', class: 'bg-primary/20 text-primary' },
    failed: { label: 'Falhou', class: 'bg-destructive/20 text-destructive' },
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Visão geral do sistema de disparos</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              <div className={`${bg} p-2 rounded-xl`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
            </div>
            <p className="text-3xl font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-2xl">
        <div className="p-6 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" />
            Campanhas Recentes
          </h3>
        </div>
        <div className="divide-y divide-border">
          {recentCampaigns.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Nenhuma campanha criada ainda
            </div>
          ) : (
            recentCampaigns.map((c) => {
              const pct = c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0
              const s = statusMap[c.status] || statusMap.draft
              return (
                <div key={c.id} className="p-5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-foreground truncate">{c.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.class}`}>{s.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-primary" /> {c.sent} enviados
                      </span>
                      <span className="flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-destructive" /> {c.failed} falhas
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {c.total} total
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-medium text-primary shrink-0">{pct}%</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
