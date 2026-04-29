'use client'

import { useState } from 'react'
import { X, Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface Preview {
  phone: string
  name: string | null
  message?: string
  error?: string
}

interface Props {
  ai_provider: string
  ai_model: string
  prompt: string
  list_id: string
  onClose: () => void
}

export default function TestMessageModal({ ai_provider, ai_model, prompt, list_id, onClose }: Props) {
  const [previews, setPreviews] = useState<Preview[]>([])
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(3)

  const generate = async () => {
    if (!ai_provider || !prompt || !list_id) {
      toast.error('Preencha provedor IA, prompt e lista antes de testar')
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/campaigns/test-message', {
        ai_provider, ai_model: ai_model || undefined, prompt, list_id, count,
      })
      setPreviews(data.previews || [])
    } catch {
      toast.error('Erro ao gerar mensagens de teste')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Pré-visualização de mensagens</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 border-b border-border flex items-center gap-3">
          <label className="text-sm text-muted-foreground">Quantidade:</label>
          <input
            type="number" min={1} max={5} value={count}
            onChange={(e) => setCount(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-16 px-2 py-1 bg-muted border border-border rounded-lg text-sm"
          />
          <button
            onClick={generate} disabled={loading}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Gerar amostras
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {previews.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-10">
              Clique em "Gerar amostras" para ver como a IA personalizará as mensagens.
            </p>
          )}
          {previews.map((p, i) => (
            <div key={i} className="bg-muted/50 border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
                <span className="font-mono">{p.phone}</span>
                {p.name && <span>{p.name}</span>}
              </div>
              {p.error ? (
                <p className="text-sm text-destructive">{p.error}</p>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{p.message}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
