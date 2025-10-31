import type { EmitExecutionEvent } from '../ipc/flows-v2/execution-events'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface StreamHandle {
  cancel: () => void
}

// Token usage information from LLM providers
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number  // Tokens served from cache (Gemini context caching)
}

// Generic tool spec used by provider-native agent runtimes
export interface AgentTool {
  name: string
  description?: string
  // JSON Schema for tool input parameters
  parameters: any
  // Executes the tool with already-validated input
  // Second parameter is optional metadata (e.g., requestId for session tracking)
  run: (input: any, meta?: { requestId?: string; [key: string]: any }) => Promise<any> | any
  // Optional: convert full tool result into minimal model payload + UI payload
  // Providers will call this to reduce tokens by returning only minimal data to the model
  // and caching heavy UI payloads keyed by previewKey.
  toModelResult?: (raw: any) => { minimal: any; ui?: any; previewKey?: string } | { minimal: any }
}

export interface ProviderAdapter {
  id: string

  // Provider-native streaming with tool-calling and optional structured outputs (single codepath)
  // Providers are stateless and accept messages in their native format
  agentStream: (opts: {
    apiKey: string
    model: string
    // Provider-specific message format (formatted by llm-service):
    // Sampling and reasoning controls
    temperature?: number
    reasoningEffort?: 'low' | 'medium' | 'high'

    messages?: ChatMessage[]  // For OpenAI
    instructions?: string  // For OpenAI Responses API (AI SDK)
    system?: any  // For Anthropic
    contents?: any[]  // For Gemini
    systemInstruction?: string  // For Gemini
    tools: AgentTool[]
    // Optional JSON Schema to enforce structured outputs (e.g., edits schema)
    responseSchema?: any
    // NEW: Event emitter (optional for backward compatibility)
    emit?: EmitExecutionEvent
    // Legacy callbacks (deprecated, use emit instead)
    onChunk: (text: string) => void
    onDone: () => void
    onError: (error: string) => void
    onTokenUsage?: (usage: TokenUsage) => void
    // Tool lifecycle callbacks (optional)
    onToolStart?: (ev: { callId?: string; name: string; arguments?: any }) => void
    onToolEnd?: (ev: { callId?: string; name: string; result?: any }) => void
    onToolError?: (ev: { callId?: string; name: string; error: string }) => void
    // Optional metadata passed to tools (e.g., requestId for session tracking)
    toolMeta?: { requestId?: string; [key: string]: any }
  }) => Promise<StreamHandle>
}


// Debug HTTP logging for provider requests (env-gated)
export function shouldLogProviderHttp(): boolean {
  try {
    return process.env.HF_LOG_LLM_HTTP === '1' || process.env.HF_LOG_LLM_FULL === '1'
  } catch {
    return false
  }
}

export function logProviderHttp(args: {
  provider: string
  method: 'POST' | 'GET' | 'PUT' | 'DELETE'
  url: string
  headers?: Record<string, any>
  body: any
  note?: string
}) {
  if (!shouldLogProviderHttp()) return
  const headers = { ...(args.headers || {}) }
  const maskMode = process.env.HF_LOG_LLM_HTTP_MASK
  const maskBearer = (val: string) => {
    if (!val) return val
    if (maskMode === 'partial') {
      const m = String(val)
      const t = m.replace(/^Bearer\s+/i, '')
      const start = t.slice(0, 4)
      const end = t.slice(-4)
      return `Bearer ${start}…${end}`
    }
    return 'Bearer ***REDACTED***'
  }
  const maskKey = (val: string) => {
    if (!val) return val
    if (maskMode === 'partial') {
      const t = String(val)
      const start = t.slice(0, 4)
      const end = t.slice(-4)
      return `${start}\u2026${end}`
    }
    return '***REDACTED***'
  }
  if (headers.Authorization) headers.Authorization = maskBearer(headers.Authorization)
  if (headers.authorization) headers.authorization = maskBearer(headers.authorization)
  if ((headers as any)['x-api-key']) (headers as any)['x-api-key'] = maskKey((headers as any)['x-api-key'])
  if ((headers as any)['x-goog-api-key']) (headers as any)['x-goog-api-key'] = maskKey((headers as any)['x-goog-api-key'])

  // Normalize URL to absolute if a relative path was provided
  const makeAbsolute = (prov: string, u: string) => {
    if (!u) return u
    if (/^https?:\/\//i.test(u)) return u
    const base = prov === 'openai' ? 'https://api.openai.com'
      : prov === 'anthropic' ? 'https://api.anthropic.com'
      : prov === 'gemini' ? 'https://generativelanguage.googleapis.com'
      : ''
    return base ? `${base}${u.startsWith('/') ? u : `/${u}`}` : u
  }
  const url = makeAbsolute(args.provider, args.url)

  // Pretty-print body JSON to avoid [Object] placeholders
  let bodyPretty: string | undefined
  try {
    bodyPretty = JSON.stringify(args.body, null, 2)
  } catch {}

  try {
    console.log('[LLM HTTP] Request', {
      provider: args.provider,
      method: args.method,
      url,
      headers,
      note: args.note
    })
    if (typeof bodyPretty === 'string') {
      console.log('[LLM HTTP] Body', bodyPretty)
    } else {
      console.log('[LLM HTTP] Body (non-JSON)', args.body)
    }
  } catch {}
}
