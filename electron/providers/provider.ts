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
  chatStream(opts: {
    apiKey: string
    model: string
    messages: ChatMessage[]
    onChunk: (text: string) => void
    onDone: () => void
    onError: (error: string) => void
    onTokenUsage?: (usage: TokenUsage) => void
    // Provider can emit conversation metadata (e.g., lastResponseId, preamble hashes)
    onConversationMeta?: (meta: { provider: string; sessionId?: string; lastResponseId?: string; preambleHash?: string; lastToolsHash?: string }) => void
    // Optional session identifier to enable provider-native conversation state
    sessionId?: string
    // Optional signal from caller to reset native conversation state for this session
    resetConversation?: boolean
  }): Promise<StreamHandle>

  // Optional provider-native agent streaming with tool-calling and optional structured outputs
  agentStream?: (opts: {
    apiKey: string
    model: string
    messages: ChatMessage[]
    tools: AgentTool[]
    // Optional JSON Schema to enforce structured outputs (e.g., edits schema)
    responseSchema?: any
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
    // Provider can emit conversation metadata (e.g., lastResponseId, preamble hashes)
    onConversationMeta?: (meta: { provider: string; sessionId?: string; lastResponseId?: string; preambleHash?: string; lastToolsHash?: string }) => void
    // Optional session identifier to enable provider-native conversation state
    sessionId?: string
    // Optional signal from caller to reset native conversation state for this session
    resetConversation?: boolean
  }) => Promise<StreamHandle>
}
