import { queryOne } from '../lib/db'
import { logger } from '../lib/logger'

export type AIProvider = 'openai' | 'gemini' | 'groq' | 'mistral'

interface AIConfig {
  provider: AIProvider
  api_key: string
  model: string | null
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-small-latest',
}

export async function generateMessage(
  provider: AIProvider,
  prompt: string,
  contactName: string,
  contactPhone: string,
  modelOverride?: string,
): Promise<string> {
  const config = await queryOne<AIConfig>(
    'SELECT provider, api_key, model FROM ai_configs WHERE provider = ? AND enabled = 1',
    [provider],
  )

  if (!config) {
    throw new Error(`Provedor de IA "${provider}" não configurado ou desativado`)
  }

  const model = modelOverride || config.model || DEFAULT_MODELS[provider]
  const systemPrompt = `Você é um assistente de vendas/marketing para WhatsApp.
REGRAS:
- Gere UMA mensagem única para o contato indicado
- Siga EXATAMENTE o formato, estilo, emojis e estrutura definidos no prompt do usuário
- Personalize com o nome do contato quando disponível
- Varie levemente o texto a cada geração para não repetir
- NUNCA mencione que a mensagem foi gerada por IA
- Retorne apenas o texto da mensagem, sem explicações`

  const userPrompt = `Contato: ${contactName || 'Cliente'} (${contactPhone})

Instruções e formato da mensagem:
${prompt}

Gere a mensagem seguindo o formato acima:`

  if (provider === 'openai') {
    return generateOpenAI(config.api_key, model, systemPrompt, userPrompt)
  } else if (provider === 'gemini') {
    return generateGemini(config.api_key, model, systemPrompt, userPrompt)
  } else if (provider === 'mistral') {
    return generateMistral(config.api_key, model, systemPrompt, userPrompt)
  } else {
    return generateGroq(config.api_key, model, systemPrompt, userPrompt)
  }
}

async function generateMistral(
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 1.1,
      max_tokens: 700,
    }),
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Mistral API ${response.status}: ${errText}`)
  }
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content?.trim() || ''
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
    max_tokens: 700,
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
    generationConfig: { temperature: 1.1, maxOutputTokens: 700 },
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
    max_tokens: 700,
  })
  return res.choices[0]?.message?.content?.trim() || ''
}

export async function generateAudio(
  provider: AIProvider,
  text: string,
  outputPath: string,
): Promise<void> {
  // TTS requer OpenAI (único provedor com suporte nativo implementado)
  const ttsProvider = provider === 'openai' ? 'openai' : 'openai'
  const config = await queryOne<AIConfig>(
    "SELECT api_key FROM ai_configs WHERE provider = ? AND enabled = 1",
    [ttsProvider],
  )
  if (!config) throw new Error('TTS requer OpenAI configurado e habilitado')
  return generateOpenAITTS(config.api_key, text, outputPath)
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
