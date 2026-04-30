'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Send, Plus, Pause, Play, Trash2, Loader2,
  CheckCircle, XCircle, Clock, Upload, Sparkles,
  ListChecks, ShieldCheck, Eye, FileText, ChevronDown,
} from 'lucide-react'

const PREDEFINED_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: 'IPTV — Teste grátis 4h',
    prompt: `Gere uma mensagem seguindo EXATAMENTE o formato abaixo. NÃO altere números, prazos, quantidades, links nem telefones. Varie apenas as palavras introdutórias e personalize com o nome do contato quando disponível:

📺✨ Solicite agora seu TESTE IPTV GRÁTIS por 4 horas!

Tenha acesso a uma lista completa com mais de 150 MIL conteúdos, incluindo:
🔥 Canais premium ao vivo
🎬 Filmes recém-saídos do cinema
📺 Séries em alta
👶 Conteúdo infantil

Compatível com todos os dispositivos:
✔️ Smart TVs
✔️ TV Box
✔️ Celulares
✔️ Tablets
✔️ Computadores

Não perca tempo! Experimente agora e descubra a melhor experiência em entretenimento 🚀

📲 Canal oficial:
WhatsApp 32-99841-4995`,
  },
  {
    label: 'Promoção genérica de produto',
    prompt: `Gere uma mensagem de oferta para WhatsApp seguindo EXATAMENTE o formato abaixo. NÃO altere números, percentuais, preços, prazos nem contatos. Varie apenas as frases introdutórias e personalize com o nome do contato:

🎉 OFERTA ESPECIAL — Só hoje!

[Descreva o produto/serviço aqui]

✅ Vantagem 1
✅ Vantagem 2
✅ Vantagem 3

⏰ Oferta válida por 24 horas
💬 Fale agora: [seu contato]`,
  },
  {
    label: 'Agendamento / Serviço local',
    prompt: `Gere uma mensagem de WhatsApp convidando para agendamento. NÃO altere telefones, endereços nem horários informados. Personalize com o nome do contato quando disponível e varie o texto introdutório:

👋 Olá! Temos uma novidade especial para você.

[Descreva o serviço aqui]

🕐 Horários disponíveis: [horários]
📍 Endereço: [endereço]
📲 Agende agora: [telefone]

Vagas limitadas! Reserve a sua 😊`,
  },
]
import { toast } from 'sonner'
import { api } from '@/lib/api'
import CampaignDetailsModal from './CampaignDetailsModal'
import TestMessageModal from './TestMessageModal'

interface Campaign {
  id: string
  name: string
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed'
  sent: number
  failed: number
  total: number
  ai_provider: string
  created_at: string
  list_name?: string
  list_id?: string
  max_per_day?: number
  daily_sent?: number
  session_ids?: string
}

interface Session { id: string; name: string; status: string }
interface ContactList { id: string; name: string; total: number }
interface AIConfig { provider: string; enabled: number }

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [lists, setLists] = useState<ContactList[]>([])
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showTestMsg, setShowTestMsg] = useState(false)
  const [detailsCampaign, setDetailsCampaign] = useState<Campaign | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [testSending, setTestSending] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const mediaRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: '', list_id: '', ai_provider: 'openai', ai_model: '',
    prompt: '', media_type: 'none', min_delay: '5', max_delay: '15',
    max_per_day: '0',
    rotate_sessions: true, session_ids: [] as string[],
  })

  useEffect(() => {
    loadAll()
    connectWS()
  }, [])

  const connectWS = () => {
    const token = localStorage.getItem('disparo_token')
    const wsBase = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3333')
    const ws = new WebSocket(`${wsBase}/api/campaigns/ws?token=${token}`)
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.event === 'update' || msg.event === 'progress') {
        setCampaigns((prev) =>
          prev.map((c) =>
            c.id === msg.campaignId
              ? { ...c, status: msg.status || c.status, sent: msg.sent ?? c.sent, failed: msg.failed ?? c.failed }
              : c,
          ),
        )
      }
    }
    ws.onclose = () => setTimeout(connectWS, 3000)
  }

  const loadAll = async () => {
    const [c, s, l, a] = await Promise.all([
      api.get('/campaigns'),
      api.get('/whatsapp/sessions'),
      api.get('/contacts/lists'),
      api.get('/ai/configs'),
    ])
    setCampaigns(c.data)
    setSessions(s.data)
    setLists(l.data)
    const enabledConfigs: AIConfig[] = a.data.filter((x: AIConfig) => x.enabled)
    setAiConfigs(enabledConfigs)
    setForm((prev) => {
      const available = enabledConfigs.find((cfg) => cfg.provider === prev.ai_provider)
      if (!available && enabledConfigs.length > 0) {
        return { ...prev, ai_provider: enabledConfigs[0].provider }
      }
      return prev
    })
  }

  const toggleSession = (id: string) => {
    setForm((prev) => ({
      ...prev,
      session_ids: prev.session_ids.includes(id)
        ? prev.session_ids.filter((s) => s !== id)
        : [...prev.session_ids, id],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.list_id || !form.ai_provider || !form.prompt) {
      return toast.error('Preencha todos os campos obrigatórios')
    }
    if (form.session_ids.length === 0) return toast.error('Selecione pelo menos um número WhatsApp')
    setSubmitting(true)

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      if (k === 'session_ids') fd.append(k, JSON.stringify(v))
      else if (k === 'rotate_sessions') fd.append(k, v ? 'true' : 'false')
      else fd.append(k, String(v))
    })

    const media = mediaRef.current?.files?.[0]
    if (media) fd.append('media', media)

    try {
      await api.post('/campaigns', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Campanha iniciada!')
      setShowForm(false)
      setForm({ name: '', list_id: '', ai_provider: aiConfigs[0]?.provider || 'openai', ai_model: '', prompt: '', media_type: 'none', min_delay: '5', max_delay: '15', max_per_day: '0', rotate_sessions: true, session_ids: [] })
      loadAll()
    } catch {
      toast.error('Erro ao criar campanha')
    } finally {
      setSubmitting(false)
    }
  }

  const pauseCampaign = async (id: string) => {
    await api.post(`/campaigns/${id}/pause`)
    setCampaigns((prev) => prev.map((c) => c.id === id ? { ...c, status: 'paused' } : c))
    toast.info('Campanha pausada')
  }

  const resumeCampaign = async (id: string) => {
    await api.post(`/campaigns/${id}/resume`)
    setCampaigns((prev) => prev.map((c) => c.id === id ? { ...c, status: 'running' } : c))
    toast.info('Campanha retomada')
  }

  const verifyNumbers = async (campaign: Campaign) => {
    const sessionIds: string[] = JSON.parse(campaign.session_ids || '[]')
    const conn = sessionIds.find((s) => sessions.find((x) => x.id === s && x.status === 'connected'))
    if (!conn) return toast.error('Nenhuma sessão conectada para validar')
    if (!campaign.list_id) return
    setVerifying(campaign.id)
    try {
      const { data } = await api.post(`/contacts/lists/${campaign.list_id}/verify-numbers`, { sessionId: conn })
      if (data.verified === 0 && data.message) {
        toast.info(data.message)
      } else {
        toast.success(`${data.valid} válidos / ${data.invalid} inválidos de ${data.total}`)
      }
    } catch {
      toast.error('Erro ao validar números')
    } finally {
      setVerifying(null)
    }
  }

  const sendTestMessages = async (campaign: Campaign) => {
    if (!confirm('Disparar 3 mensagens de teste agora?')) return
    setTestSending(campaign.id)
    try {
      const { data } = await api.post(`/campaigns/${campaign.id}/test-send`, { count: 3 })
      const sent = data.results?.filter((r: { status: string }) => r.status === 'sent').length || 0
      const failed = data.results?.length - sent
      toast.success(`Teste: ${sent} enviadas, ${failed} falharam`)
    } catch {
      toast.error('Erro no disparo de teste')
    } finally {
      setTestSending(null)
    }
  }

  const deleteCampaign = async (id: string) => {
    if (!confirm('Remover esta campanha?')) return
    await api.delete(`/campaigns/${id}`)
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
    toast.success('Campanha removida')
  }

  const statusMap: Record<string, { label: string; class: string }> = {
    draft: { label: 'Rascunho', class: 'bg-muted text-muted-foreground' },
    scheduled: { label: 'Agendado', class: 'bg-blue-500/20 text-blue-400' },
    running: { label: 'Enviando', class: 'bg-yellow-500/20 text-yellow-400' },
    paused: { label: 'Pausado', class: 'bg-orange-500/20 text-orange-400' },
    completed: { label: 'Concluído', class: 'bg-primary/20 text-primary' },
    failed: { label: 'Falhou', class: 'bg-destructive/20 text-destructive' },
  }

  const connectedSessions = sessions.filter((s) => s.status === 'connected')

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Campanhas</h2>
          <p className="text-muted-foreground mt-1">Crie e gerencie disparos em massa com IA</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Nova Campanha
        </button>
      </div>

      <div className="space-y-4">
        {campaigns.map((c) => {
          const pct = c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0
          const s = statusMap[c.status] || statusMap.draft
          return (
            <div key={c.id} className="bg-card border border-border rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">{c.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.class}`}>{s.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.list_name} • {c.ai_provider.toUpperCase()} • {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setDetailsCampaign(c)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-muted text-foreground rounded-xl hover:bg-muted/70 transition-colors">
                    <Eye className="w-3.5 h-3.5" /> Detalhes
                  </button>
                  <button onClick={() => verifyNumbers(c)} disabled={verifying === c.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500/10 text-blue-400 rounded-xl hover:bg-blue-500/20 transition-colors disabled:opacity-50">
                    {verifying === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    Validar números
                  </button>
                  <button onClick={() => sendTestMessages(c)} disabled={testSending === c.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-500/10 text-purple-400 rounded-xl hover:bg-purple-500/20 transition-colors disabled:opacity-50">
                    {testSending === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
                    Disparo teste
                  </button>
                  {c.status === 'running' && (
                    <button onClick={() => pauseCampaign(c.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500/10 text-orange-400 rounded-xl hover:bg-orange-500/20 transition-colors">
                      <Pause className="w-3.5 h-3.5" /> Pausar
                    </button>
                  )}
                  {(c.status === 'paused' || c.status === 'failed') && (
                    <button onClick={() => resumeCampaign(c.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-xl hover:bg-primary/20 transition-colors">
                      <Play className="w-3.5 h-3.5" /> Retomar
                    </button>
                  )}
                  <button onClick={() => deleteCampaign(c.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive rounded-xl hover:bg-destructive/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm text-muted-foreground mb-3">
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-primary" />{c.sent} enviados</span>
                <span className="flex items-center gap-1.5"><XCircle className="w-4 h-4 text-destructive" />{c.failed} falhas</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{c.total} total</span>
                <span className="ml-auto font-semibold text-foreground">{pct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
        {campaigns.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Send className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma campanha criada. Clique em "Nova Campanha" para começar.</p>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl my-4">
            <h3 className="text-xl font-semibold mb-6">Nova Campanha de Disparo</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm text-muted-foreground mb-1.5">Nome da campanha *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Promoção Black Friday" required
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Lista de contatos *</label>
                  <select value={form.list_id} onChange={(e) => setForm({ ...form, list_id: e.target.value })} required
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Selecione...</option>
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.total})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Provedor IA *</label>
                  <select value={form.ai_provider} onChange={(e) => setForm({ ...form, ai_provider: e.target.value })} required
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                    {aiConfigs.map((a) => <option key={a.provider} value={a.provider}>{a.provider.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Delay mín. (seg)</label>
                  <input type="number" min="3" value={form.min_delay} onChange={(e) => setForm({ ...form, min_delay: e.target.value })}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Delay máx. (seg)</label>
                  <input type="number" min="5" value={form.max_delay} onChange={(e) => setForm({ ...form, max_delay: e.target.value })}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-muted-foreground mb-1.5">Máximo de disparos por dia <span className="text-xs">(0 = sem limite; ao atingir, pausa automaticamente)</span></label>
                  <input type="number" min="0" value={form.max_per_day}
                    onChange={(e) => setForm({ ...form, max_per_day: e.target.value })}
                    placeholder="Ex: 100"
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Tipo de mídia</label>
                  <select value={form.media_type} onChange={(e) => setForm({ ...form, media_type: e.target.value })}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="none">Apenas texto</option>
                    <option value="image">Imagem + texto</option>
                    <option value="audio">Áudio (TTS) + imagem (opcional)</option>
                  </select>
                </div>
              </div>

              {form.media_type !== 'none' && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    {form.media_type === 'image' ? 'Imagem (obrigatória)' : 'Imagem (opcional para áudio)'}
                  </label>
                  <div className="flex items-center gap-3">
                    <input ref={mediaRef} type="file" accept="image/*" className="hidden" id="media-upload" />
                    <label htmlFor="media-upload" className="flex items-center gap-2 px-4 py-2.5 bg-muted border border-dashed border-border rounded-xl text-sm text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors">
                      <Upload className="w-4 h-4" /> Selecionar imagem
                    </label>
                  </div>
                </div>
              )}

              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm text-muted-foreground">Prompt para IA * <span className="text-xs">(instrução de como gerar as mensagens)</span></label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowPresets((v) => !v)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-muted border border-border rounded-lg text-xs text-muted-foreground hover:bg-muted/70 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Prompt predefinido
                      <ChevronDown className={`w-3 h-3 transition-transform ${showPresets ? 'rotate-180' : ''}`} />
                    </button>
                    {showPresets && (
                      <div className="absolute right-0 top-full mt-1 z-10 bg-card border border-border rounded-xl shadow-lg w-64 overflow-hidden">
                        {PREDEFINED_PROMPTS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, prompt: p.prompt }))
                              setShowPresets(false)
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors border-b border-border last:border-0"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} required rows={6}
                  placeholder="Cole aqui o modelo de mensagem ou use um prompt predefinido acima..."
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Números WhatsApp * <span className="text-xs">(selecione os números para rotacionar)</span></label>
                <div className="flex flex-wrap gap-2">
                  {connectedSessions.map((s) => (
                    <button type="button" key={s.id} onClick={() => toggleSession(s.id)}
                      className={`px-3 py-1.5 rounded-xl text-sm transition-colors ${form.session_ids.includes(s.id) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                      {s.name}
                    </button>
                  ))}
                  {connectedSessions.length === 0 && <p className="text-sm text-destructive">Nenhum número conectado</p>}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="py-2.5 px-4 bg-muted rounded-xl text-sm font-medium hover:bg-muted/80 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={() => setShowTestMsg(true)}
                  disabled={!form.ai_provider || !form.prompt || !form.list_id}
                  className="flex-1 py-2.5 bg-purple-500/10 text-purple-400 rounded-xl text-sm font-medium hover:bg-purple-500/20 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> Testar mensagens
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Iniciar Campanha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTestMsg && (
        <TestMessageModal
          ai_provider={form.ai_provider}
          ai_model={form.ai_model}
          prompt={form.prompt}
          list_id={form.list_id}
          onClose={() => setShowTestMsg(false)}
        />
      )}

      {detailsCampaign && (
        <CampaignDetailsModal
          campaignId={detailsCampaign.id}
          campaignName={detailsCampaign.name}
          onClose={() => setDetailsCampaign(null)}
        />
      )}
    </div>
  )
}
