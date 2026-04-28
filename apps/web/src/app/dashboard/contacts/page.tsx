'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Users, Upload, Download, Trash2, Plus, Loader2,
  FileText, UsersRound, Contact,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface ContactList {
  id: string
  name: string
  source: string
  total: number
  created_at: string
}

interface Session {
  id: string
  name: string
  status: string
}

export default function ContactsPage() {
  const [lists, setLists] = useState<ContactList[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [extractModal, setExtractModal] = useState<'group' | 'contacts' | null>(null)
  const [extractSession, setExtractSession] = useState('')
  const [extractName, setExtractName] = useState('')
  const [groups, setGroups] = useState<{ id: string; name: string; size: number }[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    loadLists()
    api.get('/whatsapp/sessions').then((r) => setSessions(r.data)).catch(() => null)
  }, [])

  const loadLists = async () => {
    const res = await api.get('/contacts/lists')
    setLists(res.data)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const listName = prompt('Nome para esta lista:', file.name.replace('.csv', ''))
    if (!listName) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      await api.post(`/contacts/import?name=${encodeURIComponent(listName)}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Lista importada com sucesso!')
      loadLists()
    } catch {
      toast.error('Erro ao importar CSV')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDeleteList = async (id: string) => {
    if (!confirm('Remover esta lista de contatos?')) return
    await api.delete(`/contacts/lists/${id}`)
    setLists((prev) => prev.filter((l) => l.id !== id))
    toast.success('Lista removida')
  }

  const handleExportCSV = (id: string) => {
    const token = localStorage.getItem('disparo_token')
    const apiBase = process.env.NEXT_PUBLIC_API_URL || ''
    window.open(`${apiBase}/api/contacts/lists/${id}/export?token=${token}`, '_blank')
  }

  const openGroupExtract = async () => {
    setExtractModal('group')
    setGroups([])
    setSelectedGroup('')
    setExtractName('')
  }

  const loadGroups = async () => {
    if (!extractSession) return
    const res = await api.get(`/whatsapp/sessions/${extractSession}/groups`)
    setGroups(res.data)
  }

  const handleExtract = async () => {
    if (!extractName.trim()) return toast.error('Informe o nome da lista')
    setExtracting(true)
    try {
      if (extractModal === 'group') {
        if (!selectedGroup) return toast.error('Selecione um grupo')
        await api.post('/contacts/extract-group', {
          sessionId: extractSession,
          groupId: selectedGroup,
          listName: extractName,
        })
      } else {
        await api.post('/contacts/extract-contacts', {
          sessionId: extractSession,
          listName: extractName,
        })
      }
      toast.success('Contatos extraídos com sucesso!')
      setExtractModal(null)
      loadLists()
    } catch {
      toast.error('Erro ao extrair contatos')
    } finally {
      setExtracting(false)
    }
  }

  const sourceIcon: Record<string, React.ReactNode> = {
    csv_import: <FileText className="w-4 h-4 text-blue-400" />,
    group_extract: <UsersRound className="w-4 h-4 text-violet-400" />,
    contact_extract: <Contact className="w-4 h-4 text-yellow-400" />,
  }

  const sourceLabel: Record<string, string> = {
    csv_import: 'CSV Importado',
    group_extract: 'Grupo WA',
    contact_extract: 'Contatos WA',
  }

  const connectedSessions = sessions.filter((s) => s.status === 'connected')

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Contatos</h2>
        <p className="text-muted-foreground mt-1">Gerencie listas de contatos para campanhas</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-8">
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Importar CSV
        </button>
        <button
          onClick={openGroupExtract}
          disabled={connectedSessions.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-card border border-border rounded-xl text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <UsersRound className="w-4 h-4 text-violet-400" /> Extrair de Grupo
        </button>
        <button
          onClick={() => { setExtractModal('contacts'); setExtractName(''); setExtractSession('') }}
          disabled={connectedSessions.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-card border border-border rounded-xl text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <Contact className="w-4 h-4 text-yellow-400" /> Extrair Contatos WA
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lists.map((l) => (
          <div key={l.id} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                {sourceIcon[l.source]}
                <div>
                  <p className="font-medium text-foreground">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{sourceLabel[l.source]}</p>
                </div>
              </div>
              <span className="text-2xl font-bold text-primary">{l.total.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {new Date(l.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <div className="flex gap-2 pt-4 border-t border-border">
              <button
                onClick={() => handleExportCSV(l.id)}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Exportar
              </button>
              <button
                onClick={() => handleDeleteList(l.id)}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remover
              </button>
            </div>
          </div>
        ))}
        {lists.length === 0 && (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma lista criada. Importe um CSV ou extraia de um grupo WhatsApp.</p>
          </div>
        )}
      </div>

      {extractModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {extractModal === 'group' ? 'Extrair de Grupo WhatsApp' : 'Extrair Contatos WhatsApp'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">Número WhatsApp</label>
                <select
                  value={extractSession}
                  onChange={(e) => { setExtractSession(e.target.value); setGroups([]) }}
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Selecione o número...</option>
                  {connectedSessions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              {extractModal === 'group' && (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-sm text-muted-foreground">Grupo</label>
                    <button onClick={loadGroups} className="text-xs text-primary hover:underline">Carregar grupos</button>
                  </div>
                  <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Selecione o grupo...</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name} ({g.size})</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">Nome da lista</label>
                <input
                  value={extractName}
                  onChange={(e) => setExtractName(e.target.value)}
                  placeholder="Ex: Grupo Clientes VIP"
                  className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setExtractModal(null)}
                className="flex-1 py-2.5 bg-muted rounded-xl text-sm font-medium hover:bg-muted/80 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleExtract}
                disabled={extracting || !extractSession || !extractName}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Extrair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
