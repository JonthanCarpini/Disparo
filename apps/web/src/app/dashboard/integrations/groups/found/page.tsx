"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface Row {
  id: string
  invite_link: string
  invite_code: string
  source: string | null
  name: string | null
  created_at: string
  already_enqueued?: number
  already_joined?: number
}

interface Session { id: string; name: string; phone: string | null; status: string }

export default function FoundGroupsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])

  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionIds, setSessionIds] = useState<string[]>([])
  const connected = useMemo(() => sessions.filter(s => s.status === 'connected'), [sessions])

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/whatsapp/sessions')
        setSessions(res.data || [])
      } catch {
        toast.error('Falha ao carregar sessões')
      }
    })()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/integrations/scraped-groups', {
        params: { page, limit, source: source || undefined, q: q || undefined },
      })
      setRows(res.data || [])
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao carregar grupos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, source])

  const toggleCode = (code: string) => {
    setSelectedCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
  }

  const enqueue = async () => {
    if (sessionIds.length === 0) return toast.error('Selecione ao menos uma sessão')
    if (selectedCodes.length === 0) return toast.error('Selecione ao menos um grupo')
    try {
      const body = {
        session_ids: sessionIds,
        invite_codes: selectedCodes,
        max_per_session_day: 0,
        start_time: null,
        end_time: null,
        source: 'scraped_list',
      }
      const res = await api.post('/integrations/enqueue-scraped-joins', body)
      toast.success(`Enfileirados ${res.data.queued} grupos`)
      setSelectedCodes([])
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao enfileirar joins')
    }
  }

  const uniqueSources = Array.from(new Set(rows.map(r => r.source || 'scraper')))

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Grupos Encontrados</h1>

      <section className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Busca</label>
            <input value={q} onChange={e => setQ(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Fonte</label>
            <select value={source} onChange={e => setSource(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border">
              <option value="">Todas</option>
              {uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Página</label>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p-1))} className="px-3 py-2 rounded-xl bg-muted border border-border">Anterior</button>
              <span className="px-3 py-2">{page}</span>
              <button onClick={() => setPage(p => p+1)} className="px-3 py-2 rounded-xl bg-muted border border-border">Próxima</button>
            </div>
          </div>
        </div>
        <div>
          <button onClick={load} className="px-4 py-2 rounded-xl bg-muted border border-border">Atualizar</button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Selecionar sessões</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {connected.map(s => (
            <label key={s.id} className={`border rounded-xl p-3 cursor-pointer ${sessionIds.includes(s.id) ? 'border-primary' : 'border-border'}`}>
              <input type="checkbox" className="mr-2" checked={sessionIds.includes(s.id)} onChange={() => setSessionIds(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} />
              <span className="text-sm">{s.name} {s.phone ? `(${s.phone})` : ''}</span>
            </label>
          ))}
          {connected.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma sessão conectada</p>}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">Resultados ({rows.length})</h2>
          <button disabled={loading || selectedCodes.length === 0 || sessionIds.length === 0}
            onClick={enqueue}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50">
            Entrar nos Selecionados
          </button>
        </div>
        <div className="overflow-auto border rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-2"><input type="checkbox" onChange={(e) => {
                  const checked = e.target.checked
                  if (checked) setSelectedCodes(rows.map(r => r.invite_code))
                  else setSelectedCodes([])
                }} /></th>
                <th className="p-2 text-left">Convite</th>
                <th className="p-2 text-left">Fonte</th>
                <th className="p-2 text-left">Nome</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 align-top">
                    <input type="checkbox" checked={selectedCodes.includes(r.invite_code)} onChange={() => toggleCode(r.invite_code)} />
                  </td>
                  <td className="p-2 align-top">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{r.invite_code}</span>
                      <a href={r.invite_link} target="_blank" rel="noreferrer" className="text-primary hover:underline">abrir</a>
                    </div>
                  </td>
                  <td className="p-2 align-top">{r.source || '-'}</td>
                  <td className="p-2 align-top">{r.name || '-'}</td>
                  <td className="p-2 align-top">
                    {r.already_joined ? <span className="text-green-600">já entrou</span> : r.already_enqueued ? <span className="text-amber-600">na fila</span> : <span className="text-muted-foreground">novo</span>}
                  </td>
                  <td className="p-2 align-top">
                    <button className="px-3 py-1 rounded-lg bg-muted border border-border" onClick={() => setSelectedCodes([r.invite_code])}>Selecionar</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Nenhum resultado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
