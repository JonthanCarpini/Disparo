'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle, XCircle, Clock, Loader2, RefreshCw } from 'lucide-react'
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

interface Props {
  campaignId: string
  campaignName: string
  onClose: () => void
}

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: typeof Clock }> = {
  aguardando: { label: 'Aguardando', class: 'bg-muted text-muted-foreground', icon: Clock },
  pending: { label: 'Aguardando', class: 'bg-muted text-muted-foreground', icon: Clock },
  sent: { label: 'Enviado', class: 'bg-primary/20 text-primary', icon: CheckCircle },
  failed: { label: 'Falhou', class: 'bg-destructive/20 text-destructive', icon: XCircle },
}

export default function CampaignDetailsModal({ campaignId, campaignName, onClose }: Props) {
  const [rows, setRows] = useState<ContactRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [filter, setFilter] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

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

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-semibold">Status por contato</h3>
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
      </div>
    </div>
  )
}
