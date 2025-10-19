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
}

export interface ProviderAdapter {
  id: string

  // Basic chat streaming (no tool-calling)
  // Providers are stateless and accept messages in their native format
  // llm-service is responsible for formatting MainFlowContext into provider-specific format
  chatStream(opts: {
    apiKey: string
    model: string
    // Provider-specific message format (formatted by llm-service):
    // - OpenAI: ChatMessage[]
    // - Anthropic: { system: any, messages: Array<{role: 'user'|'assistant', content: string}> }
    // - Gemini: { systemInstruction: string, contents: Array<{role: string, parts: Array<{text: string}>}> }
    messages?: ChatMessage[]  // For OpenAI
    system?: any  // For Anthropic
    contents?: any[]  // For Gemini
    systemInstruction?: string  // For Gemini
    // NEW: Event emitter (optional for backward compatibility)
    emit?: EmitExecutionEvent
    // Legacy callbacks (deprecated, use emit instead)
    onChunk: (text: string) => void
    onDone: () => void
    onError: (error: string) => void
    onTokenUsage?: (usage: TokenUsage) => void
  }): Promise<StreamHandle>

  // Optional provider-native agent streaming with tool-calling and optional structured outputs
  // Providers are stateless and accept messages in their native format
  agentStream?: (opts: {
    apiKey: string
    model: string
    // Provider-specific message format (formatted by llm-service):
    messages?: ChatMessage[]  // For OpenAI
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
