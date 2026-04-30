'use client'

import { useEffect, useState } from 'react'
import { Bot, Save, TestTube2, Loader2, Eye, EyeOff, Plus, Trash2, ChevronDown, Key, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface AIConfig {
  provider: string
  model: string | null
  enabled: number
  api_key?: string
}

interface ProviderKey {
  id: number
  label: string
  api_key_preview: string
  enabled: number
  created_at: string
}

const MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'ministral-8b-latest',
    'ministral-3b-latest',
    'open-mistral-7b',
    'open-mixtral-8x7b',
    'open-mixtral-8x22b',
  ],
}

const PROVIDER_INFO: Record<string, { label: string; color: string; desc: string }> = {
  openai: { label: 'OpenAI', color: 'text-green-400', desc: 'GPT-4o, GPT-4 Turbo. Melhor qualidade e suporte a TTS.' },
  gemini: { label: 'Google Gemini', color: 'text-blue-400', desc: 'Gemini 1.5 Pro e Flash. Excelente custo-benefício.' },
  groq: { label: 'Groq', color: 'text-orange-400', desc: 'Llama, Mixtral. Ultra rápido e gratuito.' },
  mistral: { label: 'Mistral AI', color: 'text-red-400', desc: 'Mistral Large, Medium, Small e Ministral. Modelos europeus de alta qualidade.' },
}

export default function AIPage() {
  const [configs, setConfigs] = useState<Record<string, AIConfig>>({})
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  const [providerKeys, setProviderKeys] = useState<Record<string, ProviderKey[]>>({})
  const [showMultiKeys, setShowMultiKeys] = useState<Record<string, boolean>>({})
  const [newKey, setNewKey] = useState<Record<string, { label: string; api_key: string }>>({})
  const [addingKey, setAddingKey] = useState<Record<string, boolean>>({})
  const [showNewKeyInput, setShowNewKeyInput] = useState<Record<string, boolean>>({})

  useEffect(() => {
    api.get('/ai/configs').then((r) => {
      const map: Record<string, AIConfig> = {}
      r.data.forEach((c: AIConfig) => { map[c.provider] = c })
      setConfigs(map)
    })
  }, [])

  const loadProviderKeys = async (provider: string) => {
    const r = await api.get(`/ai/keys/${provider}`)
    setProviderKeys((prev) => ({ ...prev, [provider]: r.data }))
  }

  const toggleMultiKeys = async (provider: string) => {
    const next = !showMultiKeys[provider]
    setShowMultiKeys((prev) => ({ ...prev, [provider]: next }))
    if (next && !providerKeys[provider]) {
      await loadProviderKeys(provider)
    }
  }

  const handleAddKey = async (provider: string) => {
    const k = newKey[provider]
    if (!k?.api_key) return toast.error('Informe a chave API')
    setAddingKey((prev) => ({ ...prev, [provider]: true }))
    try {
      await api.post(`/ai/keys/${provider}`, { api_key: k.api_key, label: k.label || undefined })
      toast.success('Chave adicionada!')
      setNewKey((prev) => ({ ...prev, [provider]: { label: '', api_key: '' } }))
      setShowNewKeyInput((prev) => ({ ...prev, [provider]: false }))
      await loadProviderKeys(provider)
    } catch {
      toast.error('Erro ao adicionar chave')
    } finally {
      setAddingKey((prev) => ({ ...prev, [provider]: false }))
    }
  }

  const handleDeleteKey = async (provider: string, id: number) => {
    if (!confirm('Remover esta chave?')) return
    await api.delete(`/ai/keys/${provider}/${id}`)
    toast.success('Chave removida')
    await loadProviderKeys(provider)
  }

  const handleToggleKey = async (provider: string, key: ProviderKey) => {
    await api.put(`/ai/keys/${provider}/${key.id}`, { enabled: !key.enabled })
    await loadProviderKeys(provider)
  }

  const handleSave = async (provider: string) => {
    setSaving({ ...saving, [provider]: true })
    try {
      await api.put(`/ai/configs/${provider}`, {
        api_key: apiKeys[provider] || undefined,
        model: configs[provider]?.model || undefined,
        enabled: !!configs[provider]?.enabled,
      })
      toast.success(`Configuração do ${PROVIDER_INFO[provider].label} salva!`)
      const res = await api.get('/ai/configs')
      const map: Record<string, AIConfig> = {}
      res.data.forEach((c: AIConfig) => { map[c.provider] = c })
      setConfigs(map)
    } catch {
      toast.error('Erro ao salvar configuração')
    } finally {
      setSaving({ ...saving, [provider]: false })
    }
  }

  const handleTest = async (provider: string) => {
    setTesting({ ...testing, [provider]: true })
    setTestResults({ ...testResults, [provider]: '' })
    try {
      const res = await api.post('/ai/test', { provider, prompt: 'Olá! Me apresente com 2 frases.' })
      setTestResults({ ...testResults, [provider]: res.data.message })
      toast.success('Teste bem-sucedido!')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao testar'
      setTestResults({ ...testResults, [provider]: `Erro: ${msg}` })
      toast.error('Falha no teste')
    } finally {
      setTesting({ ...testing, [provider]: false })
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Inteligência Artificial</h2>
        <p className="text-muted-foreground mt-1">Configure os provedores de IA para geração de mensagens personalizadas</p>
      </div>

      <div className="space-y-6">
        {Object.entries(PROVIDER_INFO).map(([provider, info]) => {
          const config = configs[provider]
          const enabled = !!config?.enabled
          const keys = providerKeys[provider] ?? []
          const keyCount = keys.length

          return (
            <div key={provider} className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="bg-muted p-2.5 rounded-xl">
                    <Bot className={`w-5 h-5 ${info.color}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{info.label}</h3>
                    <p className="text-xs text-muted-foreground">{info.desc}</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-sm text-muted-foreground">Habilitado</span>
                  <div
                    onClick={() => setConfigs({
                      ...configs,
                      [provider]: { ...config, provider, model: config?.model || null, enabled: enabled ? 0 : 1 },
                    })}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${enabled ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'left-5' : 'left-0.5'}`} />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">API Key principal</label>
                  <div className="relative">
                    <input
                      type={showKeys[provider] ? 'text' : 'password'}
                      value={apiKeys[provider] || ''}
                      onChange={(e) => setApiKeys({ ...apiKeys, [provider]: e.target.value })}
                      placeholder={config ? '••••••••••••••••••• (configurada)' : 'sk-...'}
                      className="w-full pl-3 pr-10 py-2.5 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeys({ ...showKeys, [provider]: !showKeys[provider] })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKeys[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Modelo padrão</label>
                  <select
                    value={config?.model || ''}
                    onChange={(e) => setConfigs({
                      ...configs,
                      [provider]: { ...config, provider, model: e.target.value, enabled: config?.enabled ?? 1 },
                    })}
                    className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Padrão</option>
                    {(MODELS[provider] || []).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => handleSave(provider)}
                  disabled={saving[provider]}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saving[provider] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Salvar
                </button>
                {config && (
                  <button
                    onClick={() => handleTest(provider)}
                    disabled={testing[provider]}
                    className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-xl text-sm font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors"
                  >
                    {testing[provider] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube2 className="w-3.5 h-3.5" />}
                    Testar
                  </button>
                )}
              </div>

              {testResults[provider] && (
                <div className={`mb-4 p-3 rounded-xl text-sm ${testResults[provider].startsWith('Erro') ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-foreground'}`}>
                  <p className="font-medium mb-1">{testResults[provider].startsWith('Erro') ? '❌ Erro' : '✅ Resultado'}</p>
                  <p className="text-muted-foreground">{testResults[provider]}</p>
                </div>
              )}

              {/* Seção de múltiplas chaves para rodízio */}
              <div className="border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => toggleMultiKeys(provider)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Chaves adicionais para rodízio</span>
                  {keyCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded-full">{keyCount}</span>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showMultiKeys[provider] ? 'rotate-180' : ''}`} />
                </button>

                {showMultiKeys[provider] && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Adicione múltiplas chaves API para rodízio automático — ideal para evitar limite de tokens por hora. As chaves abaixo são usadas em ordem circular junto com a chave principal.
                    </p>

                    {keys.length > 0 && (
                      <div className="space-y-2 mt-3">
                        {keys.map((k) => (
                          <div key={k.id} className="flex items-center gap-3 p-3 bg-muted/50 border border-border rounded-xl">
                            <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{k.label}</p>
                              <p className="text-xs text-muted-foreground font-mono">{k.api_key_preview}</p>
                            </div>
                            <div
                              onClick={() => handleToggleKey(provider, k)}
                              className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer shrink-0 ${!!k.enabled ? 'bg-primary' : 'bg-muted border border-border'}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${!!k.enabled ? 'left-4' : 'left-0.5'}`} />
                            </div>
                            <button
                              onClick={() => handleDeleteKey(provider, k.id)}
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {showNewKeyInput[provider] ? (
                      <div className="mt-3 p-3 bg-muted/30 border border-border rounded-xl space-y-2">
                        <input
                          type="text"
                          placeholder="Nome da conta (ex: Conta 2)"
                          value={newKey[provider]?.label || ''}
                          onChange={(e) => setNewKey((prev) => ({ ...prev, [provider]: { ...prev[provider], label: e.target.value } }))}
                          className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <input
                          type="password"
                          placeholder="Chave API"
                          value={newKey[provider]?.api_key || ''}
                          onChange={(e) => setNewKey((prev) => ({ ...prev, [provider]: { ...prev[provider], api_key: e.target.value } }))}
                          className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAddKey(provider)}
                            disabled={addingKey[provider]}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            {addingKey[provider] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                            Adicionar
                          </button>
                          <button
                            onClick={() => setShowNewKeyInput((prev) => ({ ...prev, [provider]: false }))}
                            className="px-3 py-1.5 bg-muted border border-border rounded-lg text-xs text-muted-foreground hover:bg-muted/70 transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowNewKeyInput((prev) => ({ ...prev, [provider]: true }))}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-border rounded-xl text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Adicionar chave
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
