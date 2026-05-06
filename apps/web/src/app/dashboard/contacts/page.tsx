'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Users, Upload, Download, Trash2, Plus, Loader2,
  FileText, UsersRound, Contact, RefreshCw, Eye, Search, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface ContactList {
  id: string
  name: string
  source: string
  total: number
  created_at: string
  campaigns_count: number
}

interface ContactRow {
  id: string
  phone: string
  name: string
  wa_exists: number | null
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
  const [syncingN8n, setSyncingN8n] = useState(false)

  const [viewingList, setViewingList] = useState<ContactList | null>(null)
  const [viewContacts, setViewContacts] = useState<ContactRow[]>([])
  const [viewLoading, setViewLoading] = useState(false)
  const [viewSearch, setViewSearch] = useState('')

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

  const handleExportCSV = async (id: string, name: string) => {
    try {
      const res = await api.get(`/contacts/lists/${id}/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${name.replace(/\s+/g, '_')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Erro ao exportar lista')
    }
  }

  const openContactsModal = async (list: ContactList) => {
    setViewingList(list)
    setViewContacts([])
    setViewLoading(true)
    setViewSearch('')
    try {
      const res = await api.get(`/contacts/lists/${list.id}`)
      setViewContacts(res.data.contacts)
    } catch {
      toast.error('Erro ao carregar contatos')
    } finally {
      setViewLoading(false)
    }
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

  const handleSyncN8n = async () => {
    setSyncingN8n(true)
    try {
      await api.post('/integrations/trigger-n8n-import')
      toast.info('Workflow N8N iniciado! Aguardando conclusão de todos os grupos...')

      const triggerTime = Date.now()
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const [syncRes, listsRes] = await Promise.all([
            api.get('/integrations/n8n-last-sync'),
            api.get('/contacts/lists'),
          ])
          setLists(listsRes.data)

          const completedAt = syncRes.data.completed_at
            ? new Date(syncRes.data.completed_at).getTime()
            : null

          if (completedAt && completedAt > triggerTime) {
            clearInterval(poll)
            const total = (listsRes.data as ContactList[]).reduce(
              (acc: number, l: ContactList) => acc + l.total, 0,
            )
            toast.success(`Sincronização concluída! ${total.toLocaleString()} contatos no total.`)
          } else if (attempts >= 36) {
            clearInterval(poll)
            toast.info('Tempo limite atingido. Atualize a página para ver novos contatos.')
          }
        } catch {}
      }, 5000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erro ao acionar workflow N8N')
    } finally {
      setSyncingN8n(false)
    }
  }

  const sourceIcon: Record<string, React.ReactNode> = {
    csv_import: <FileText className="w-4 h-4 text-blue-400" />,
    group_extract: <UsersRound className="w-4 h-4 text-violet-400" />,
    contact_extract: <Contact className="w-4 h-4 text-yellow-400" />,
    n8n_group_import: <RefreshCw className="w-4 h-4 text-violet-400" />,
  }

  const sourceLabel: Record<string, string> = {
    csv_import: 'CSV Importado',
    group_extract: 'Grupo WA',
    contact_extract: 'Contatos WA',
    n8n_group_import: 'N8N / Evolution',
  }

  const connectedSessions = sessions.filter((s) => s.status === 'connected')

  const filteredContacts = viewContacts.filter((c) => {
    if (!viewSearch) return true
    const q = viewSearch.toLowerCase()
    return c.phone.includes(q) || (c.name || '').toLowerCase().includes(q)
  })

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
        <button
          onClick={handleSyncN8n}
          disabled={syncingN8n}
          className="flex items-center gap-2 px-4 py-2.5 bg-card border border-violet-500/30 rounded-xl text-sm font-medium text-violet-400 hover:bg-violet-500/10 disabled:opacity-50 transition-colors"
        >
          {syncingN8n ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sincronizar via N8N
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lists.map((l) => (
          <div key={l.id} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-start gap-2 min-w-0">
                <div className="mt-0.5 shrink-0">{sourceIcon[l.source]}</div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate" title={l.name}>{l.name}</p>
                  <p className="text-xs text-muted-foreground">{sourceLabel[l.source] ?? l.source}</p>
                </div>
              </div>
              <span className="text-2xl font-bold text-primary shrink-0">{l.total.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground">
                {new Date(l.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              {l.campaigns_count > 0 ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                  {l.campaigns_count} {l.campaigns_count === 1 ? 'campanha' : 'campanhas'}
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Sem campanhas
                </span>
              )}
            </div>
            <div className="flex gap-2 pt-4 border-t border-border">
              <button
                onClick={() => openContactsModal(l)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Ver
              </button>
              <button
                onClick={() => handleExportCSV(l.id, l.name)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Exportar
              </button>
              <button
                onClick={() => handleDeleteList(l.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
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

      {/* Modal: visualizar contatos */}
      {viewingList && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground truncate" title={viewingList.name}>
                  {viewingList.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {viewingList.total.toLocaleString()} contatos
                </p>
              </div>
              <button
                onClick={() => setViewingList(null)}
                className="p-1.5 hover:bg-muted rounded-lg shrink-0 ml-3"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-b border-border shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={viewSearch}
                  onChange={(e) => setViewSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone..."
                  className="w-full pl-8 pr-3 py-2 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {viewSearch && (
                <p className="text-xs text-muted-foreground mt-2">
                  {filteredContacts.length} de {viewContacts.length} contatos
                </p>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {viewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  {viewSearch ? 'Nenhum contato encontrado.' : 'Lista vazia.'}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredContacts.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        c.wa_exists === 1 ? 'bg-green-500' :
                        c.wa_exists === 0 ? 'bg-red-500' :
                        'bg-muted-foreground/40'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{c.phone}</p>
                        {c.name && (
                          <p className="text-xs text-muted-foreground truncate">{c.name}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border shrink-0 flex items-center justify-between">
              <p className="text-xs text-muted-foreground flex gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Verificado
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> Inválido
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" /> Não verificado
                </span>
              </p>
              <button
                onClick={() => setViewingList(null)}
                className="px-4 py-2 bg-muted rounded-xl text-sm hover:bg-muted/80 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: extrair grupo / contatos WA */}
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
