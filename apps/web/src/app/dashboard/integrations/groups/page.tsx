"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { toast } from 'react-hot-toast'

interface Session { id: string; name: string; phone: string | null; status: string; warming_daily_limit?: number }

export default function GroupsScraperPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [sources, setSources] = useState('')
  const [userAgent, setUserAgent] = useState('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36')
  const [perSourceLimit, setPerSourceLimit] = useState('100')
  const [globalLimit, setGlobalLimit] = useState('500')
  const [chunkSize, setChunkSize] = useState('50')
  const [maxPerSessionDay, setMaxPerSessionDay] = useState('10')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [blacklist, setBlacklist] = useState('facebook.com\ninstagram.com\ntwitter.com\nx.com')
  const [loading, setLoading] = useState(false)

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

  const connected = useMemo(() => sessions.filter(s => s.status === 'connected'), [sessions])

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleRun = async () => {
    if (selected.length === 0) return toast.error('Selecione ao menos uma sessão')
    const srcs = sources.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    if (srcs.length === 0) return toast.error('Informe ao menos uma fonte')
    setLoading(true)
    try {
      const body = {
        session_ids: selected,
        sources: srcs,
        user_agent: userAgent,
        per_source_limit: parseInt(perSourceLimit) || 0,
        global_limit: parseInt(globalLimit) || 0,
        chunk_size: parseInt(chunkSize) || 50,
        max_per_session_day: parseInt(maxPerSessionDay) || 0,
        start_time: startTime || null,
        end_time: endTime || null,
        blacklist_domains: blacklist.split(/\r?\n|,|;|\s/).map(s => s.trim()).filter(Boolean),
      }
      const res = await api.post('/integrations/scrape-and-join', body)
      toast.success(`Encontrados ${res.data.total_found}, enfileirados ${res.data.queued}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao iniciar scraper')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Scraper de Grupos (Convites WhatsApp)</h1>

      <section className="space-y-2">
        <h2 className="font-medium">1) Selecionar sessões</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {connected.map(s => (
            <label key={s.id} className={`border rounded-xl p-3 cursor-pointer ${selected.includes(s.id) ? 'border-primary' : 'border-border'}`}>
              <input type="checkbox" className="mr-2" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              <span className="text-sm">{s.name} {s.phone ? `(${s.phone})` : ''}</span>
            </label>
          ))}
          {connected.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma sessão conectada</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">2) Fontes (uma por linha)</h2>
        <textarea value={sources} onChange={e => setSources(e.target.value)} rows={5}
          className="w-full p-3 rounded-xl bg-muted border border-border" placeholder="https://exemplo.com/lista-de-grupos.html" />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">User-Agent</label>
          <input value={userAgent} onChange={e => setUserAgent(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Limite por fonte (0 = ilimitado)</label>
          <input value={perSourceLimit} onChange={e => setPerSourceLimit(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Limite global (0 = ilimitado)</label>
          <input value={globalLimit} onChange={e => setGlobalLimit(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Chunk size (join por lote)</label>
          <input value={chunkSize} onChange={e => setChunkSize(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Máx por sessão/dia</label>
          <input value={maxPerSessionDay} onChange={e => setMaxPerSessionDay(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Início (HH:mm)</label>
            <input value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Fim (HH:mm)</label>
            <input value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm text-muted-foreground mb-1">Blacklist de domínios (um por linha)</label>
          <textarea value={blacklist} onChange={e => setBlacklist(e.target.value)} rows={3}
            className="w-full p-2 rounded-xl bg-muted border border-border" />
        </div>
      </section>

      <div className="flex gap-3">
        <button disabled={loading} onClick={handleRun}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50">
          {loading ? 'Processando...' : 'Iniciar Scraper' }
        </button>
      </div>
    </div>
  )
}
