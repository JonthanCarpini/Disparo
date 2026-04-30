'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  X, CheckCircle, XCircle, Clock, Loader2, RefreshCw,
  Radio, ChevronDown, ChevronUp,
} from 'lucide-react'
import { api } from '@/lib/api'

interface ContactRow {
  contact_id: string
  phone: string
  name: string | null
  jid: string | null
  status: 'aguardando' | 'sent' | 'failed' | 'pending' | string
  sent_at: string | null
  error: string | null
}

interface Totals {
  total: number
  sent: number
  failed: number
  aguardando: number
}

interface FeedItem {
  id: string
  time: Date
  phone: string
  name: string | null
  sessionId: string
  aiProvider: string
  aiModel: string | null
  status: 'sent' | 'failed'
  message?: string
  error?: string
  delay?: number
}

interface CurrentlySending {
  phone: string
  name: string | null
  sessionId: string
  aiProvider: string
  aiModel: string | null
}

interface Session { id: string; name: string }

interface Props {
  campaignId: string
  campaignName: string
  campaignStatus: string
  sessions: Session[]
  onClose: () => void
}

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: typeof Clock }> = {
  aguardando: { label: 'Aguardando', class: 'bg-muted text-muted-foreground', icon: Clock },
  pending: { label: 'Aguardando', class: 'bg-muted text-muted-foreground', icon: Clock },
  sent: { label: 'Enviado', class: 'bg-primary/20 text-primary', icon: CheckCircle },
  failed: { label: 'Falhou', class: 'bg-destructive/20 text-destructive', icon: XCircle },
}

function FeedCard({ item, sessionName }: { item: FeedItem; sessionName: string }) {
  const [expanded, setExpanded] = useState(false)
  const msg = item.message || ''
  const short = msg.slice(0, 120)
  const hasMore = msg.length > 120

  return (
    <div className={`p-4 border-b border-border ${item.status === 'sent' ? 'bg-primary/5' : 'bg-destructive/5'}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {item.status === 'sent'
            ? <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
            : <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />}
          <span className="font-mono text-sm truncate">{item.phone}</span>
          {item.name && <span className="text-muted-foreground text-sm truncate">({item.name})</span>}
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {item.time.toLocaleTimeString('pt-BR')}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mb-2">
        <span>📱 {sessionName}</span>
        <span>🤖 {item.aiProvider.toUpperCase()}{item.aiModel ? ` (${item.aiModel.replace(/-latest$/, '')})` : ''}</span>
        {item.delay !== undefined && item.delay > 0 && <span>⏱ {item.delay}s delay</span>}
      </div>
      {item.status === 'sent' && msg && (
        <div className="text-xs text-foreground/80 bg-muted/30 rounded-lg px-3 py-2">
          <p className="whitespace-pre-wrap">{expanded ? msg : short}{!expanded && hasMore ? '…' : ''}</p>
          {hasMore && (
            <button onClick={() => setExpanded((v) => !v)} className="mt-1 flex items-center gap-1 text-primary hover:underline">
              {expanded ? <><ChevronUp className="w-3 h-3" /> Menos</> : <><ChevronDown className="w-3 h-3" /> Ver mensagem</>}
            </button>
          )}
        </div>
      )}
      {item.status === 'failed' && item.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 mt-1">
          {item.error.slice(0, 200)}
        </div>
      )}
    </div>
  )
}

export default function CampaignDetailsModal({ campaignId, campaignName, campaignStatus, sessions, onClose }: Props) {
  const [tab, setTab] = useState<'contacts' | 'live'>('contacts')
  const [rows, setRows] = useState<ContactRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [filter, setFilter] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [currentlySending, setCurrentlySending] = useState<CurrentlySending | null>(null)
  const [hasLiveActivity, setHasLiveActivity] = useState(false)

  const sessionMap = new Map(sessions.map((s) => [s.id, s.name]))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/campaigns/${campaignId}/contacts-status`, {
        params: { page, limit: 100, status: filter || undefined },
      })
      setRows(data.contacts || [])
      if (data.totals) setTotals(data.totals)
    } finally {
      setLoading(false)
    }
  }, [campaignId, filter, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const token = localStorage.getItem('disparo_token')
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3333'
    const ws = new WebSocket(`${wsBase}/api/campaigns/ws?token=${token}`)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.campaignId !== campaignId) return

      if (msg.event === 'sending') {
        setCurrentlySending({
          phone: msg.phone,
          name: msg.name ?? null,
          sessionId: msg.sessionId,
          aiProvider: msg.aiProvider,
          aiModel: msg.aiModel ?? null,
        })
        setHasLiveActivity(true)
      } else if (msg.event === 'progress') {
        setCurrentlySending(null)
        setHasLiveActivity(true)
        setFeed((prev) => [{
          id: `${msg.phone}-${Date.now()}`,
          time: new Date(),
          phone: msg.phone,
          name: msg.name ?? null,
          sessionId: msg.sessionId || '',
          aiProvider: msg.aiProvider || '',
          aiModel: msg.aiModel ?? null,
          status: msg.status as 'sent' | 'failed',
          message: msg.message,
          error: msg.error,
          delay: msg.delay,
        }, ...prev.slice(0, 49)])
        if (msg.sent !== undefined || msg.failed !== undefined) {
          setTotals((prev) => prev ? {
            ...prev,
            sent: msg.sent ?? prev.sent,
            failed: msg.failed ?? prev.failed,
            aguardando: prev.total - (msg.sent ?? prev.sent) - (msg.failed ?? prev.failed),
          } : prev)
        }
      }
    }

    return () => { ws.close() }
  }, [campaignId])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-semibold">Detalhes da campanha</h3>
            <p className="text-sm text-muted-foreground">{campaignName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {totals && (
          <div className="grid grid-cols-4 gap-3 p-5 border-b border-border">
            <button
              onClick={() => { setFilter(''); setPage(1) }}
              className={`text-center p-3 rounded-xl ${filter === '' ? 'bg-primary/10 ring-1 ring-primary' : 'bg-muted'}`}
            >
              <div className="text-2xl font-bold">{totals.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </button>
            <button
              onClick={() => { setFilter('aguardando'); setPage(1) }}
              className={`text-center p-3 rounded-xl ${filter === 'aguardando' ? 'bg-yellow-500/10 ring-1 ring-yellow-500' : 'bg-muted'}`}
            >
              <div className="text-2xl font-bold text-yellow-500">{totals.aguardando}</div>
              <div className="text-xs text-muted-foreground">Aguardando</div>
            </button>
            <button
              onClick={() => { setFilter('sent'); setPage(1) }}
              className={`text-center p-3 rounded-xl ${filter === 'sent' ? 'bg-primary/10 ring-1 ring-primary' : 'bg-muted'}`}
            >
              <div className="text-2xl font-bold text-primary">{totals.sent}</div>
              <div className="text-xs text-muted-foreground">Enviados</div>
            </button>
            <button
              onClick={() => { setFilter('failed'); setPage(1) }}
              className={`text-center p-3 rounded-xl ${filter === 'failed' ? 'bg-destructive/10 ring-1 ring-destructive' : 'bg-muted'}`}
            >
              <div className="text-2xl font-bold text-destructive">{totals.failed}</div>
              <div className="text-xs text-muted-foreground">Falharam</div>
            </button>
          </div>
        )}

        <div className="flex border-b border-border px-5">
          <button
            onClick={() => setTab('contacts')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'contacts' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Contatos
          </button>
          <button
            onClick={() => setTab('live')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'live' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Radio className={`w-3.5 h-3.5 ${campaignStatus === 'running' ? 'text-primary animate-pulse' : ''}`} />
            Ao vivo
            {hasLiveActivity && tab !== 'live' && (
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse ml-0.5" />
            )}
          </button>
        </div>

        {tab === 'contacts' && (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="text-sm text-muted-foreground">Página {page}</span>
              <div className="flex gap-2">
                <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80">
                  <RefreshCw className="w-3.5 h-3.5" /> Atualizar
                </button>
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                  className="px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80 disabled:opacity-50">
                  Anterior
                </button>
                <button onClick={() => setPage(page + 1)} disabled={rows.length < 100}
                  className="px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80 disabled:opacity-50">
                  Próxima
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && rows.length === 0 && (
                <div className="text-center py-10 text-muted-foreground">Nenhum contato</div>
              )}
              {!loading && rows.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 sticky top-0">
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="px-5 py-2">Telefone</th>
                      <th className="px-5 py-2">Nome</th>
                      <th className="px-5 py-2">Status</th>
                      <th className="px-5 py-2">Enviado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.aguardando
                      const Icon = cfg.icon
                      return (
                        <tr key={r.contact_id} className="border-t border-border hover:bg-muted/20">
                          <td className="px-5 py-2.5 font-mono text-xs">{r.phone}</td>
                          <td className="px-5 py-2.5 text-muted-foreground truncate max-w-[200px]">{r.name || '-'}</td>
                          <td className="px-5 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${cfg.class}`}>
                              <Icon className="w-3 h-3" /> {cfg.label}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-xs text-muted-foreground">
                            {r.sent_at ? new Date(r.sent_at).toLocaleString('pt-BR') : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {tab === 'live' && (
          <div className="flex-1 overflow-y-auto">
            {currentlySending && (
              <div className="m-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-yellow-400">Gerando e enviando...</span>
                </div>
                <div className="text-sm font-mono">
                  {currentlySending.phone}
                  {currentlySending.name && <span className="text-muted-foreground ml-2">({currentlySending.name})</span>}
                </div>
                <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span>📱 {sessionMap.get(currentlySending.sessionId) || currentlySending.sessionId}</span>
                  <span>🤖 {currentlySending.aiProvider.toUpperCase()}{currentlySending.aiModel ? ` (${currentlySending.aiModel.replace(/-latest$/, '')})` : ''}</span>
                </div>
              </div>
            )}

            {feed.length === 0 && !currentlySending && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Radio className="w-10 h-10 opacity-30" />
                <p className="text-sm">
                  {campaignStatus === 'running'
                    ? 'Aguardando atividade...'
                    : 'Inicie ou retome a campanha para ver o feed em tempo real.'}
                </p>
              </div>
            )}

            {feed.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                sessionName={sessionMap.get(item.sessionId) || item.sessionId || '—'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
