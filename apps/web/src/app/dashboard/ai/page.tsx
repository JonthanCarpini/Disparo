'use client'

import { useEffect, useState } from 'react'
import { Bot, Save, TestTube2, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface AIConfig {
  provider: string
  model: string | null
  enabled: number
  api_key?: string
}

const MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
}

const PROVIDER_INFO: Record<string, { label: string; color: string; desc: string }> = {
  openai: { label: 'OpenAI', color: 'text-green-400', desc: 'GPT-4o, GPT-4 Turbo. Melhor qualidade e suporte a TTS.' },
  gemini: { label: 'Google Gemini', color: 'text-blue-400', desc: 'Gemini 1.5 Pro e Flash. Excelente custo-benefício.' },
  groq: { label: 'Groq', color: 'text-orange-400', desc: 'Llama, Mixtral. Ultra rápido e gratuito.' },
}

export default function AIPage() {
  const [configs, setConfigs] = useState<Record<string, AIConfig>>({})
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  useEffect(() => {
    api.get('/ai/configs').then((r) => {
      const map: Record<string, AIConfig> = {}
      r.data.forEach((c: AIConfig) => { map[c.provider] = c })
      setConfigs(map)
    })
  }, [])

  const handleSave = async (provider: string) => {
    setSaving({ ...saving, [provider]: true })
    try {
      await api.put(`/ai/configs/${provider}`, {
        api_key: apiKeys[provider] || undefined,
        model: configs[provider]?.model || undefined,
        enabled: configs[provider]?.enabled !== 0,
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
          const enabled = config?.enabled !== 0
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
                  <label className="block text-sm text-muted-foreground mb-1.5">API Key</label>
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

              <div className="flex gap-3">
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
                <div className={`mt-4 p-3 rounded-xl text-sm ${testResults[provider].startsWith('Erro') ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-foreground'}`}>
                  <p className="font-medium mb-1">{testResults[provider].startsWith('Erro') ? '❌ Erro' : '✅ Resultado'}</p>
                  <p className="text-muted-foreground">{testResults[provider]}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
