import type { AgentTool, ChatMessage, ChatMessagePart } from '../../providers/provider'
import type { MainFlowContext, MessagePart } from '../types'

const OPENAI_REASONING_PROVIDERS = new Set(['fireworks', 'openrouter'])

export function estimateTokensFromText(value: string | undefined | null): number {
  if (!value) return 0
  const asciiWeightedLen = String(value).replace(/[^\x00-\x7F]/g, 'xx').length
  return Math.ceil(asciiWeightedLen / 4)
}

export function normalizeContentToText(content: string | MessagePart[]): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n')
}

export function estimateInputTokens(provider: string, formattedMessages: any): number {
  try {
    if (provider === 'anthropic') {
      const systemBlocks = formattedMessages?.system as Array<{ type: string; text?: string }> | undefined
      const messages = formattedMessages?.messages as Array<{ content: string | any[] }> | undefined
      let total = 0
      if (Array.isArray(systemBlocks)) {
        for (const block of systemBlocks) {
          total += estimateTokensFromText((block as any)?.text)
        }
      }
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (typeof msg.content === 'string') {
            total += estimateTokensFromText(msg.content)
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'text') total += estimateTokensFromText(part.text)
              if (part.type === 'image') total += 1000 // Heuristic for images
            }
          }
        }
      }
      return total
    }

    if (provider === 'gemini') {
      const systemInstruction = formattedMessages?.systemInstruction as string | undefined
      const contents = formattedMessages?.contents as Array<{ parts: Array<{ text?: string; inline_data?: any }> }> | undefined
      let total = estimateTokensFromText(systemInstruction)
      if (Array.isArray(contents)) {
        for (const content of contents) {
          if (Array.isArray(content?.parts)) {
            for (const part of content.parts) {
              if (part.text) total += estimateTokensFromText(part.text)
              if (part.inline_data) total += 1000
            }
          }
        }
      }
      return total
    }

    const messages = formattedMessages as Array<{ content: string | any[] }> | undefined
    let total = 0
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          total += estimateTokensFromText(msg.content)
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') total += estimateTokensFromText(part.text)
            if (part.type === 'image_url') total += 1000
          }
        }
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

  // Find the last user message index to keep its images
  const lastUserMsgIndex = [...history].reverse().findIndex((m) => m.role === 'user')
  const actualLastUserIndex = lastUserMsgIndex === -1 ? -1 : history.length - 1 - lastUserMsgIndex

  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    let content: string | ChatMessagePart[]

    if (typeof msg.content === 'string') {
      content = msg.content
      if (msg.role === 'assistant' && shouldEmbedReasoning) {
        const trimmedReasoning = msg.reasoning ? String(msg.reasoning).trim() : ''
        if (trimmedReasoning) {
          const suffix = content ? `\n${content}` : ''
          content = `<think>${trimmedReasoning}</think>${suffix}`
        }
      }
    } else {
      // Multi-modal content
      const isLastUserMessage = i === actualLastUserIndex
      
      content = msg.content
        .map((part) => {
          if (part.type === 'text') {
            return { type: 'text' as const, text: part.text }
          } else if (isLastUserMessage) {
            return {
              type: 'image' as const,
              image: part.image,
              mimeType: part.mimeType,
            }
          }
          return null
        })
        .filter((p): p is ChatMessagePart => p !== null)

      // If all images were stripped and no text remains, add a placeholder
      if (content.length === 0) {
        content = '[Image]'
      }
    }

    const out: any = { role: msg.role, content }
    // NOTE: tool_calls and tool roles are deliberately ignored here.
    // The scheduler and llm-service now feed tool results back as user messages
    // to maintain context without persisting tool-specific protocol fields.
    if (msg.role !== 'tool') {
      messages.push(out)
    }
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
  
  // Find the last user message index to keep its images
  const lastUserMsgIndex = [...history].reverse().findIndex((m) => m.role === 'user')
  const actualLastUserIndex = lastUserMsgIndex === -1 ? -1 : history.length - 1 - lastUserMsgIndex

  const messages = history
    .filter((msg) => msg.role !== 'system')
    .map((entry) => {
      // Adjusted index for history after system filter
      const originalIndex = history.indexOf(entry)
      const isLastUserMessage = originalIndex === actualLastUserIndex

      let content: any
      if (typeof entry.content === 'string') {
        content = entry.content
      } else {
        const parts = entry.content
          .map((part) => {
            if (part.type === 'text') {
              return { type: 'text', text: part.text }
            } else if (isLastUserMessage) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: part.mimeType,
                  data: part.image,
                },
              }
            }
            return null
          })
          .filter((p) => p !== null)

        content = parts.length > 0 ? parts : '[Image]'
      }

      return { role: entry.role as 'user' | 'assistant', content }
    })
    .filter((m) => m.role === 'user' || m.role === 'assistant')

  return { system, messages }
}

export function formatMessagesForGemini(
  context: MainFlowContext
): {
  systemInstruction: string
  contents: Array<{ role: string; parts: Array<any> }>
} {
  const systemInstruction = context.systemInstructions || ''
  const history = Array.isArray(context.messageHistory) ? context.messageHistory : []

  // Find the last user message index to keep its images
  const lastUserMsgIndex = [...history].reverse().findIndex((m) => m.role === 'user')
  const actualLastUserIndex = lastUserMsgIndex === -1 ? -1 : history.length - 1 - lastUserMsgIndex

  const contents = history
    .filter((msg) => msg.role !== 'system')
    .map((msg) => {
      const originalIndex = history.indexOf(msg)
      const isLastUserMessage = originalIndex === actualLastUserIndex
      const parts: Array<any> = []

      if (msg.role === 'assistant') {
        const trimmedReasoning = msg.reasoning ? String(msg.reasoning).trim() : ''
        if (trimmedReasoning) {
          parts.push({ text: `<think>${trimmedReasoning}</think>` })
        }
      }

      if (typeof msg.content === 'string') {
        if (msg.content) parts.push({ text: msg.content })
      } else {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text })
          } else if (isLastUserMessage) {
            parts.push({
              inline_data: {
                mime_type: part.mimeType,
                data: part.image,
              },
            })
          }
        }
        if (parts.length === 0 && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          parts.push({ text: '[Image]' })
        }
      }

      return {
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts,
      }
    })
    .filter((m) => m.role === 'user' || m.role === 'model')

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
      ? contents.map((content: any, index: number) => ({ idx: index, parts: Array.isArray(content?.parts) ? content.parts.length : 0, preview: previewText((content?.parts || []).map((part: any) => part?.text || '[IMAGE]').join(' '), 200) }))
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
