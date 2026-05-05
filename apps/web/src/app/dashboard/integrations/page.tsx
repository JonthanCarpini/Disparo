'use client'

import { useEffect, useState } from 'react'
import { Plug, Plus, Trash2, Copy, Check, Power, Loader2, Key, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface ApiKey {
  id: number
  label: string
  key_preview: string
  enabled: number
  last_used_at: string | null
  created_at: string
}

export default function IntegrationsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<{ label: string; key: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/integrations/keys')
      setKeys(data)
    } catch {
      toast.error('Erro ao carregar API keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!newLabel.trim()) return toast.error('Informe um rótulo')
    setCreating(true)
    try {
      const { data } = await api.post('/integrations/keys', { label: newLabel })
      setCreatedKey({ label: data.label, key: data.key })
      setNewLabel('')
      setShowCreate(false)
      await load()
    } catch {
      toast.error('Erro ao criar API key')
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (k: ApiKey) => {
    await api.put(`/integrations/keys/${k.id}`, { enabled: !k.enabled })
    toast.success(k.enabled ? 'Chave desativada' : 'Chave ativada')
    load()
  }

  const handleDelete = async (k: ApiKey) => {
    if (!confirm(`Remover a chave "${k.label}"? Esta ação não pode ser desfeita.`)) return
    await api.delete(`/integrations/keys/${k.id}`)
    toast.success('Chave removida')
    load()
  }

  const copyKey = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Integrações</h2>
          <p className="text-muted-foreground mt-1">API keys para integrar n8n, Evolution API e outros sistemas externos</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" /> Nova API Key
        </button>
      </div>

      {/* Documentação rápida */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Plug className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Endpoint para n8n / Evolution API</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Envie grupos do WhatsApp diretamente para o Disparo. Cada chamada cria/atualiza uma lista de contatos identificada por <code className="px-1.5 py-0.5 bg-muted rounded text-xs">groupJid</code>.
        </p>
        <div className="bg-muted rounded-xl p-4 font-mono text-xs overflow-x-auto">
          <div className="text-primary font-semibold mb-2">POST http://178.238.236.103:3001/api/integrations/import-group</div>
          <div className="text-muted-foreground mb-1">Headers:</div>
          <div className="ml-2 mb-2">
            <div>Content-Type: application/json</div>
            <div>X-API-Key: <span className="text-yellow-400">dsp_xxxxxxxxxxxxxxxx</span></div>
          </div>
          <div className="text-muted-foreground mb-1">Body:</div>
          <pre className="ml-2 text-foreground">{`{
  "groupJid": "120363042...@g.us",
  "subject": "Take Gourmet Vendas",
  "participants": [
    { "phone": "5511999999999", "jid": "5511999999999@s.whatsapp.net", "name": "João" },
    { "jid": "12345678901@lid" }
  ]
}`}</pre>
        </div>
      </div>

      {/* Lista de chaves */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-12">
            <Key className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Nenhuma API key criada ainda</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-5 py-3">Rótulo</th>
                <th className="px-5 py-3">Chave</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Último uso</th>
                <th className="px-5 py-3">Criada em</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-5 py-3 font-medium">{k.label}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{k.key_preview}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      k.enabled ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {k.enabled ? 'Ativa' : 'Desativada'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {new Date(k.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleToggle(k)}
                        className="p-1.5 hover:bg-muted rounded-lg"
                        title={k.enabled ? 'Desativar' : 'Ativar'}
                      >
                        <Power className={`w-4 h-4 ${k.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                      </button>
                      <button
                        onClick={() => handleDelete(k)}
                        className="p-1.5 hover:bg-destructive/10 rounded-lg"
                        title="Remover"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal criar */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">Nova API Key</h3>
            <label className="block text-sm text-muted-foreground mb-1.5">Rótulo (identifica o uso)</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex: n8n - Evolution API"
              className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCreate(false); setNewLabel('') }}
                className="flex-1 py-2.5 bg-muted rounded-xl text-sm hover:bg-muted/80"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                Gerar chave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal exibir chave criada (única vez) */}
      {createdKey && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center gap-2 mb-3 text-yellow-400">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-lg font-semibold">Guarde esta chave agora</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              A chave <strong className="text-foreground">{createdKey.label}</strong> só será mostrada uma vez. Copie e guarde em local seguro.
            </p>
            <div className="bg-muted rounded-xl p-3 font-mono text-xs break-all mb-4">
              {createdKey.key}
            </div>
            <div className="flex gap-3">
              <button
                onClick={copyKey}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 flex items-center justify-center gap-2"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado!' : 'Copiar chave'}
              </button>
              <button
                onClick={() => setCreatedKey(null)}
                className="px-4 py-2.5 bg-muted rounded-xl text-sm hover:bg-muted/80"
              >
                Já copiei
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
