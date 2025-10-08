export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface StreamHandle {
  cancel: () => void
}

// Generic tool spec used by provider-native agent runtimes
export interface AgentTool {
  name: string
  description?: string
  // JSON Schema for tool input parameters
  parameters: any
  // Executes the tool with already-validated input
  run: (input: any) => Promise<any> | any
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
  }) => Promise<StreamHandle>
}
