import type { AgentTool, ChatMessage } from '../../providers/provider'
import type { MainFlowContext } from '../types'

const OPENAI_REASONING_PROVIDERS = new Set(['fireworks'])

export function estimateTokensFromText(value: string | undefined | null): number {
  if (!value) return 0
  const asciiWeightedLen = String(value).replace(/[^\x00-\x7F]/g, 'xx').length
  return Math.ceil(asciiWeightedLen / 4)
}

export function estimateInputTokens(provider: string, formattedMessages: any): number {
  try {
    if (provider === 'anthropic') {
      const systemBlocks = formattedMessages?.system as Array<{ type: string; text?: string }> | undefined
      const messages = formattedMessages?.messages as Array<{ content: string }> | undefined
      let total = 0
      if (Array.isArray(systemBlocks)) {
        for (const block of systemBlocks) {
          total += estimateTokensFromText((block as any)?.text)
        }
      }
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          total += estimateTokensFromText(msg?.content)
        }
      }
      return total
    }

    if (provider === 'gemini') {
      const systemInstruction = formattedMessages?.systemInstruction as string | undefined
      const contents = formattedMessages?.contents as Array<{ parts: Array<{ text: string }> }> | undefined
      let total = estimateTokensFromText(systemInstruction)
      if (Array.isArray(contents)) {
        for (const content of contents) {
          if (Array.isArray(content?.parts)) {
            for (const part of content.parts) {
              total += estimateTokensFromText(part?.text)
            }
          }
        }
      }
      return total
    }

    const messages = formattedMessages as Array<{ content: string }> | undefined
    let total = 0
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        total += estimateTokensFromText(msg?.content)
      }
    }
    return total
  } catch {
    return 0
  }
}

export function formatMessagesForOpenAI(
  context: MainFlowContext,
  options?: { provider?: string }
): ChatMessage[] {
  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []
  const messages: ChatMessage[] = []
  const systemText = context.systemInstructions
  if (systemText) {
    messages.push({ role: 'system', content: systemText })
  }
  const shouldEmbedReasoning = options?.provider ? OPENAI_REASONING_PROVIDERS.has(options.provider) : false
  for (const msg of history) {
    let content = msg.content
    if (msg.role === 'assistant' && shouldEmbedReasoning) {
      const trimmedReasoning = (msg as any)?.reasoning ? String((msg as any).reasoning).trim() : ''
      if (trimmedReasoning) {
        const suffix = content ? `\n${content}` : ''
        content = `<think>${trimmedReasoning}</think>${suffix}`
      }
    }
    messages.push({ role: msg.role, content })
  }
  return messages
}

export function formatMessagesForAnthropic(
  context: MainFlowContext
): {
  system?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
  messages: Array<{ role: 'user' | 'assistant'; content: any }>
} {
  const systemInstructions = context.systemInstructions || ''
  const system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> | undefined =
    systemInstructions
      ? [{ type: 'text' as const, text: systemInstructions, cache_control: { type: 'ephemeral' as const } }]
      : undefined

  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []
  const messages = history.map((entry) => ({ role: entry.role as 'user' | 'assistant', content: entry.content }))

  return { system, messages }
}

export function formatMessagesForGemini(
  context: MainFlowContext
): {
  systemInstruction: string
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
} {
  const systemInstruction = context.systemInstructions || ''
  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []
  const contents = history
    .filter(msg => msg.role !== 'system')
    .map(msg => {
      const parts: Array<{ text: string }> = []
      if (msg.role === 'assistant') {
        const trimmedReasoning = (msg as any)?.reasoning ? String((msg as any).reasoning).trim() : ''
        if (trimmedReasoning) {
          parts.push({ text: `<think>${trimmedReasoning}</think>` })
        }
      }
      parts.push({ text: msg.content })
      return {
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts,
      }
    })

  return { systemInstruction, contents }
}

function previewText(val: any, max = 400): string {
  try {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val)
    return serialized.length > max ? `${serialized.slice(0, max)}…` : serialized
  } catch {
    return ''
  }
}

export function buildLoggablePayload(
  provider: string,
  streamOpts: any,
  extras?: { responseSchema?: any; tools?: AgentTool[] }
): Record<string, any> {
  const { apiKey: _omitApiKey, messages, system, systemInstruction, contents, instructions, ...rest } = (streamOpts || {})
  const out: Record<string, any> = { provider, ...rest }

  if (provider === 'anthropic') {
    out.systemBlocks = Array.isArray(system) ? system.length : 0
    out.messages = Array.isArray(messages)
      ? messages.map((msg: any, index: number) => ({ idx: index, role: msg?.role, preview: previewText(msg?.content, 200) }))
      : undefined
  } else if (provider === 'gemini') {
    out.systemInstructionPreview = previewText(systemInstruction, 200)
    out.contents = Array.isArray(contents)
      ? contents.map((content: any, index: number) => ({ idx: index, parts: Array.isArray(content?.parts) ? content.parts.length : 0, preview: previewText((content?.parts || []).map((part: any) => part?.text).join(' '), 200) }))
      : undefined
  } else {
    if (typeof instructions === 'string' && instructions) {
      out.instructions = previewText(instructions, 200)
    } else if (typeof system === 'string' && system) {
      out.instructions = previewText(system, 200)
    }
    out.messages = Array.isArray(messages)
      ? messages.map((msg: any, index: number) => ({ idx: index, role: msg?.role, preview: previewText(msg?.content, 200) }))
      : undefined
  }

  if (extras?.responseSchema) {
    out.responseSchema = {
      name: extras.responseSchema.name,
      strict: !!extras.responseSchema.strict,
      keys: Object.keys(extras.responseSchema.schema?.properties || {})
    }
  }

  if (extras?.tools) {
    out.tools = (extras.tools || []).map(tool => tool?.name).filter(Boolean)
  }

  return out
}

export function logLLMRequestPayload(args: {
  provider: string
  model?: string
  streamType: 'chat' | 'agent'
  streamOpts: any
  responseSchema?: any
  tools?: AgentTool[]
}): void {
  try {
    const payload = buildLoggablePayload(args.provider, args.streamOpts, { responseSchema: args.responseSchema, tools: args.tools })
    console.log('[LLMRequest] Payload', {
      provider: args.provider,
      model: args.model,
      streamType: args.streamType,
      payload
    })
  } catch {}
}

