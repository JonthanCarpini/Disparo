"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface Session { id: string; name: string; phone: string | null; status: string; warming_daily_limit?: number }

export default function GroupsScraperPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<'sources' | 'crawler'>('sources')
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

  // Crawler state
  const [rootUrl, setRootUrl] = useState('https://www.gruposdewhatss.com.br/')
  const [maxPages, setMaxPages] = useState('80')
  const [maxDepth, setMaxDepth] = useState('2')
  const [perPageLimit, setPerPageLimit] = useState('50')
  const [allowRegex, setAllowRegex] = useState('^/(categoria|grupos|top|pagina|buscar|tag|page)/?.*')
  const [denyRegex, setDenyRegex] = useState('\\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|json|xml|txt)$')

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
    if (mode === 'sources') {
      const srcs = sources.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      if (srcs.length === 0) return toast.error('Informe ao menos uma fonte')
      setLoading(true)
      try {
        const body = {
          sources: srcs,
          user_agent: userAgent,
          per_source_limit: parseInt(perSourceLimit) || 0,
          global_limit: parseInt(globalLimit) || 0,
          blacklist_domains: blacklist.split(/\r?\n|,|;|\s/).map(s => s.trim()).filter(Boolean),
        }
        const res = await api.post('/integrations/scrape-only', body)
        toast.success(`Salvos ${res.data.total_saved} convites`)
        router.push('/dashboard/integrations/groups/found')
      } catch (e: any) {
        toast.error(e?.response?.data?.error || 'Falha ao raspar (fontes)')
      } finally {
        setLoading(false)
      }
      return
    }

    // crawler mode
    if (!rootUrl) return toast.error('Informe a URL raiz do domínio')
    setLoading(true)
    try {
      const res = await api.post('/integrations/crawl-domain-and-join', {
        session_ids: selected,
        root_url: rootUrl,
        user_agent: userAgent,
        max_pages: parseInt(maxPages) || 50,
        max_depth: parseInt(maxDepth) || 2,
        per_page_limit: parseInt(perPageLimit) || 0,
        global_limit: parseInt(globalLimit) || 0,
        chunk_size: parseInt(chunkSize) || 50,
        max_per_session_day: parseInt(maxPerSessionDay) || 0,
        start_time: startTime || null,
        end_time: endTime || null,
        path_allow_regex: allowRegex,
        blacklist_paths_regex: denyRegex,
      })
      toast.success(`Domínio: ${res.data.domain} | Páginas: ${res.data.pages_crawled} | Encontrados ${res.data.total_found}, enfileirados ${res.data.queued}`)
      router.push('/dashboard/integrations/groups/audit')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Falha ao iniciar crawler por domínio')
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

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setMode('sources')} className={`px-3 py-1.5 rounded-lg text-sm ${mode==='sources'?'bg-primary text-primary-foreground':'bg-muted text-foreground'}`}>Modo: Fontes</button>
          <button onClick={() => setMode('crawler')} className={`px-3 py-1.5 rounded-lg text-sm ${mode==='crawler'?'bg-primary text-primary-foreground':'bg-muted text-foreground'}`}>Modo: Crawler por Domínio</button>
        </div>

        {mode === 'sources' && (
          <div className="space-y-2">
            <h2 className="font-medium">2) Fontes (uma por linha)</h2>
            <textarea value={sources} onChange={e => setSources(e.target.value)} rows={5}
              className="w-full p-3 rounded-xl bg-muted border border-border" placeholder="https://exemplo.com/lista-de-grupos.html" />
          </div>
        )}

        {mode === 'crawler' && (
          <div className="space-y-4">
            <h2 className="font-medium">2) Crawler por Domínio</h2>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">URL raiz</label>
              <input value={rootUrl} onChange={e => setRootUrl(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Máx páginas</label>
                <input value={maxPages} onChange={e => setMaxPages(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Máx profundidade</label>
                <input value={maxDepth} onChange={e => setMaxDepth(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Limite por página</label>
                <input value={perPageLimit} onChange={e => setPerPageLimit(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Allow path (regex)</label>
              <input value={allowRegex} onChange={e => setAllowRegex(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Deny path (regex)</label>
              <input value={denyRegex} onChange={e => setDenyRegex(e.target.value)} className="w-full p-2 rounded-xl bg-muted border border-border" />
            </div>
          </div>
        )}
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
        <button onClick={() => router.push('/dashboard/integrations/groups/found')}
          className="px-4 py-2 rounded-xl bg-muted border border-border">
          Ver Grupos Encontrados
        </button>
      </div>
    </div>
  )
}
