"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface JoinRow {
  id: number
  session_id: string
  invite_code: string
  invite_link?: string
  status: 'queued'|'joined'|'failed'|'skipped'
  error: string | null
  source: string | null
  created_at: string
  updated_at: string
}

interface Session { id: string; name: string; phone: string | null; status: string }

export default function GroupsAuditPage() {
  const [rows, setRows] = useState<JoinRow[]>([])
  const [status, setStatus] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [source, setSource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [paused, setPaused] = useState<boolean | null>(null)
  const [queue, setQueue] = useState<{waiting:number;active:number;delayed:number;failed:number;completed:number} | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/whatsapp/sessions')
        setSessions(res.data || [])
      } catch {}
      try {
        const st = await api.get('/integrations/n8n-webhook') // ping leve reutilizado
        // ignorar valor; apenas para garantir auth ok
      } catch {}
    })()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      try {
        const st = await api.get('/integrations/group-joins/status')
        setPaused(Boolean(st.data?.paused))
        setQueue(st.data?.queue || null)
      } catch {}
      const res = await api.get('/integrations/group-joins', { params: { status: status || undefined, session_id: sessionId || undefined, page, limit, source: source || undefined, from: from || undefined, to: to || undefined } })
      const arr = (res.data || []) as JoinRow[]
      setRows(arr.sort((a,b)=> new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao carregar auditoria')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() // eslint-disable-next-line
  }, [status, sessionId, page, limit, source, from, to])

  const connected = useMemo(() => sessions.filter(s => s.status === 'connected'), [sessions])

  const handleLeave = async (r: JoinRow) => {
    const sess = connected.find(s => s.id === r.session_id)
    if (!sess) return toast.error('Sessão não conectada')
    const groupId = prompt('Informe o ID do grupo (jid do grupo, ex: 1203630xxx-xxx@g.us) para sair:')
    if (!groupId) return
    try {
      await api.post('/integrations/leave-group-jwt', { session_id: r.session_id, group_id: groupId })
      toast.success('Solicitado sair do grupo')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao sair do grupo')
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">Auditoria de Entradas em Grupos</h1>

      <div className="flex items-center gap-3">
        <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={async()=>{ try{ await api.post('/integrations/group-joins/pause'); setPaused(true); toast.success('Processamento pausado') }catch(e:any){ toast.error(e?.response?.data?.error||'Falha ao pausar') } }}>Pausar processamento</button>
        <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={async()=>{ try{ await api.post('/integrations/group-joins/resume'); setPaused(false); toast.success('Processamento retomado') }catch(e:any){ toast.error(e?.response?.data?.error||'Falha ao retomar') } }}>Retomar processamento</button>
        <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={load}>Atualizar</button>
        {paused !== null && (
          <span className={`px-2 py-1 rounded-lg text-xs ${paused?'bg-yellow-600/20 text-yellow-400':'bg-emerald-600/20 text-emerald-400'}`}>paused: {String(paused)}</span>
        )}
        {queue && (
          <span className="text-xs text-muted-foreground">waiting:{queue.waiting} active:{queue.active} delayed:{queue.delayed} failed:{queue.failed} completed:{queue.completed}</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border">
            <option value="">Todos</option>
            <option value="queued">queued</option>
            <option value="joined">joined</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Fonte</label>
          <input value={source} onChange={e => setSource(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" placeholder="ex: crawler:www.gruposdewhatss.com.br" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">De (YYYY-MM-DD)</label>
          <input value={from} onChange={e => setFrom(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Até (YYYY-MM-DD)</label>
          <input value={to} onChange={e => setTo(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Sessão</label>
          <select value={sessionId} onChange={e => setSessionId(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border">
            <option value="">Todas</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name} {s.phone?`(${s.phone})`:''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Página</label>
          <input value={page} onChange={e => setPage(parseInt(e.target.value)||1)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Limite</label>
          <input value={limit} onChange={e => setLimit(parseInt(e.target.value)||50)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Data</th>
              <th className="text-left p-2">Sessão</th>
              <th className="text-left p-2">Convite</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Fonte</th>
              <th className="text-left p-2">Erro</th>
              <th className="text-left p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-2">{r.session_id}</td>
                <td className="p-2"><a href={r.invite_link || `https://chat.whatsapp.com/${r.invite_code}`} className="text-primary underline" target="_blank" rel="noopener noreferrer">abrir</a></td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.source || '-'}</td>
                <td className="p-2 text-destructive">{r.error || '-'}</td>
                <td className="p-2">
                  <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={() => handleLeave(r)}>Sair do grupo</button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td className="p-4 text-center text-muted-foreground" colSpan={7}>Sem registros</td></tr>
            )}
            {loading && (
              <tr><td className="p-4 text-center" colSpan={7}>Carregando...</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 justify-end">
        <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={() => setPage(p => Math.max(1, p-1))}>Anterior</button>
        <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={() => setPage(p => p+1)}>Próxima</button>
      </div>
    </div>
  )
}
