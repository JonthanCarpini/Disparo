'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, RefreshCw, Wifi, WifiOff, Smartphone, Loader2, Image as ImgIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface Session {
  id: string
  name: string
  phone: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'banned'
}

const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3333') + '/api/whatsapp/ws'

export default function WhatsAppPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    loadSessions()
    connectWS()
    return () => wsRef.current?.close()
  }, [])

  const connectWS = () => {
    const token = localStorage.getItem('disparo_token')
    const ws = new WebSocket(`${WS_URL}?token=${token}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.event === 'qr') {
        setQrMap((prev) => ({ ...prev, [msg.sessionId]: msg.qr }))
      }
      if (msg.event === 'status') {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === msg.sessionId
              ? { ...s, status: msg.status, phone: msg.phone || s.phone }
              : s,
          ),
        )
        if (msg.status === 'connected') {
          setQrMap((prev) => {
            const next = { ...prev }
            delete next[msg.sessionId]
            return next
          })
          toast.success(`Número conectado!`)
        }
      }
    }

    ws.onclose = () => setTimeout(connectWS, 3000)
  }

  const loadSessions = async () => {
    const res = await api.get('/whatsapp/sessions')
    setSessions(res.data)
  }

  const addSession = async () => {
    if (!newName.trim()) return toast.error('Informe um nome para o número')
    setLoading(true)
    try {
      await api.post('/whatsapp/sessions', { name: newName.trim() })
      setNewName('')
      await loadSessions()
      toast.success('Número adicionado! Escaneie o QR Code')
    } catch {
      toast.error('Erro ao adicionar número')
    } finally {
      setLoading(false)
    }
  }

  const removeSession = async (id: string) => {
    if (!confirm('Remover este número? A sessão será encerrada.')) return
    await api.delete(`/whatsapp/sessions/${id}`)
    setSessions((prev) => prev.filter((s) => s.id !== id))
    toast.success('Número removido')
  }

  const reconnect = async (id: string) => {
    await api.post(`/whatsapp/sessions/${id}/reconnect`)
    toast.info('Reconectando...')
  }

  const statusIcon = (s: Session['status']) => {
    if (s === 'connected') return <Wifi className="w-4 h-4 text-primary" />
    if (s === 'banned') return <WifiOff className="w-4 h-4 text-destructive" />
    if (s === 'connecting') return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
    return <WifiOff className="w-4 h-4 text-muted-foreground" />
  }

  const statusLabel: Record<Session['status'], string> = {
    connected: 'Conectado',
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    banned: 'Banido',
  }
  const statusClass: Record<Session['status'], string> = {
    connected: 'bg-primary/20 text-primary',
    disconnected: 'bg-muted text-muted-foreground',
    connecting: 'bg-yellow-500/20 text-yellow-400',
    banned: 'bg-destructive/20 text-destructive',
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Números WhatsApp</h2>
        <p className="text-muted-foreground mt-1">Gerencie os números para disparo. Escaneie o QR Code para conectar.</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSession()}
            placeholder="Nome do número (ex: Vendas Principal)"
            className="flex-1 px-4 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={addSession}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Adicionar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sessions.map((s) => (
          <div key={s.id} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-muted p-2.5 rounded-xl">
                  <Smartphone className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.phone || 'Aguardando...'}</p>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1.5 ${statusClass[s.status]}`}>
                {statusIcon(s.status)}
                {statusLabel[s.status]}
              </span>
            </div>

            {qrMap[s.id] ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <p className="text-xs text-muted-foreground">Escaneie com o WhatsApp</p>
                <img src={qrMap[s.id]} alt="QR Code" className="w-48 h-48 rounded-xl border border-border" />
              </div>
            ) : s.status === 'connected' ? (
              <div className="flex items-center justify-center py-4 text-primary gap-2">
                <Wifi className="w-5 h-5" />
                <span className="text-sm font-medium">Pronto para disparos</span>
              </div>
            ) : (
              <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
                <ImgIcon className="w-5 h-5" />
                <span className="text-sm">QR Code será exibido aqui</span>
              </div>
            )}

            <div className="flex gap-2 mt-4 pt-4 border-t border-border">
              {s.status !== 'connected' && s.status !== 'connecting' && (
                <button
                  onClick={() => reconnect(s.id)}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reconectar
                </button>
              )}
              <button
                onClick={() => removeSession(s.id)}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remover
              </button>
            </div>
          </div>
        ))}

        {sessions.length === 0 && (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum número adicionado. Adicione um número acima para começar.</p>
          </div>
        )}
      </div>
    </div>
  )
}
