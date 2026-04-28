import { queryOne } from '../lib/db'
import { logger } from '../lib/logger'

export type AIProvider = 'openai' | 'gemini' | 'groq'

interface AIConfig {
  provider: AIProvider
  api_key: string
  model: string | null
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  groq: 'llama-3.3-70b-versatile',
}

export async function generateMessage(
  provider: AIProvider,
  prompt: string,
  contactName: string,
  contactPhone: string,
): Promise<string> {
  const config = await queryOne<AIConfig>(
    'SELECT provider, api_key, model FROM ai_configs WHERE provider = ? AND enabled = 1',
    [provider],
  )

  if (!config) {
    throw new Error(`Provedor de IA "${provider}" não configurado ou desativado`)
  }

  const model = config.model || DEFAULT_MODELS[provider]
  const systemPrompt = `Você é um assistente de vendas/marketing. Gere uma mensagem ÚNICA e PERSONALIZADA para WhatsApp.
REGRAS IMPORTANTES:
- A mensagem deve ser diferente de qualquer mensagem anterior
- Use linguagem natural e informal, como uma pessoa real
- Personalize com o nome do contato quando disponível
- Não use emojis em excesso (máximo 2-3)
- Seja conciso (máximo 3 parágrafos curtos)
- NUNCA mencione que a mensagem foi gerada por IA
- Varie o início, meio e fim da mensagem a cada geração`

  const userPrompt = `Contato: ${contactName || 'Cliente'} (${contactPhone})
Prompt base do usuário: ${prompt}

Gere UMA mensagem única e personalizada para este contato:`

  if (provider === 'openai') {
    return generateOpenAI(config.api_key, model, systemPrompt, userPrompt)
  } else if (provider === 'gemini') {
    return generateGemini(config.api_key, model, systemPrompt, userPrompt)
  } else {
    return generateGroq(config.api_key, model, systemPrompt, userPrompt)
  }
}

async function generateOpenAI(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.1,
    max_tokens: 400,
  })
  return res.choices[0]?.message?.content?.trim() || ''
}

async function generateGemini(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(apiKey)
  const genModel = genAI.getGenerativeModel({ model, systemInstruction: system })
  const result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 1.1, maxOutputTokens: 400 },
  })
  return result.response.text().trim()
}

async function generateGroq(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const Groq = (await import('groq-sdk')).default
  const client = new Groq({ apiKey })
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.1,
    max_tokens: 400,
  })
  return res.choices[0]?.message?.content?.trim() || ''
}

export async function generateAudio(
  provider: AIProvider,
  text: string,
  outputPath: string,
): Promise<void> {
  const config = await queryOne<AIConfig>(
    'SELECT api_key FROM ai_configs WHERE provider = ? AND enabled = 1',
    [provider === 'groq' ? 'openai' : provider],
  )

  if (!config) {
    const fallback = await queryOne<AIConfig>(
      "SELECT api_key FROM ai_configs WHERE provider = 'openai' AND enabled = 1",
    )
    if (!fallback) throw new Error('Nenhum provedor OpenAI configurado para TTS')
    return generateOpenAITTS(fallback.api_key, text, outputPath)
  }

  if (provider === 'openai' || provider === 'groq') {
    return generateOpenAITTS(config.api_key, text, outputPath)
  }

  const fallback = await queryOne<AIConfig>(
    "SELECT api_key FROM ai_configs WHERE provider = 'openai' AND enabled = 1",
  )
  if (!fallback) throw new Error('TTS requer OpenAI configurado')
  return generateOpenAITTS(fallback.api_key, text, outputPath)
}

async function generateOpenAITTS(apiKey: string, text: string, outputPath: string): Promise<void> {
  const { default: OpenAI } = await import('openai')
  const fs = await import('fs')
  const client = new OpenAI({ apiKey })
  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: text,
    response_format: 'opus',
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(outputPath, buffer)
  logger.info({ outputPath }, 'Áudio TTS gerado')
}
