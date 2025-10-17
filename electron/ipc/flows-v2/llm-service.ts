/**
 * LLM Service - Unified abstraction layer for all LLM provider interactions
 * 
 * This service handles:
 * - Provider selection and API key retrieval
 * - Context/conversation management (provider-specific session state)
 * - Message history formatting
 * - Tool execution coordination
 * - Event emission (chunks, tokens, tool lifecycle)
 * - Error handling
 * 
 * Benefits:
 * - Nodes are provider-agnostic (no provider-specific logic in nodes)
 * - Event handling is centralized (no duplication)
 * - Context management is unified (single source of truth)
 * - Easy to test (mock the service, not individual providers)
 * - Provider switching is built-in
 */

import type { MainFlowContext } from './types'
import type { AgentTool, TokenUsage, ChatMessage } from '../../providers/provider'
import { providers } from '../../core/state'
import { getProviderKey } from '../../core/state'
import { useMainStore } from '../../store'

/**
 * Request to the LLM service
 */
export interface LLMServiceRequest {
  /** User message to send */
  message: string

  /** Optional tools for agent mode */
  tools?: AgentTool[]

  /** Main flow context (contains provider, model, history, etc.) */
  context: MainFlowContext

  /** Node ID for event routing */
  nodeId: string

  /** Optional JSON schema for structured output */
  responseSchema?: any

  /** Override provider (for nodes that use their own provider, like intentRouter) */
  overrideProvider?: string

  /** Override model (for nodes that use their own model, like intentRouter) */
  overrideModel?: string

  /** Skip adding message to context history (for stateless calls like intentRouter) */
  skipHistory?: boolean
}

/**
 * Response from the LLM service
 */
export interface LLMServiceResponse {
  /** Assistant's response text */
  text: string

  /** Updated context with new messages */
  updatedContext: MainFlowContext

  /** Error message if request failed */
  error?: string
}

/**
 * Provider-specific session state
 */
interface ProviderSessionState {
  // OpenAI state
  openai?: {
    lastResponseId?: string
    systemHash?: string
    toolsHash?: string
  }
  
  // Gemini state
  gemini?: {
    chatInstance?: any
    agentContents?: any[]
  }
  
  // Anthropic needs no state (sends full history every time)
}

/**
 * Context Manager - handles provider-specific session state and message formatting
 */
class ContextManager {
  // Session state keyed by contextId-sessionId
  private sessions = new Map<string, ProviderSessionState>()
  
  /**
   * Get messages to send to provider
   * Handles provider-specific logic for message history
   */
  getMessagesToSend(context: MainFlowContext): ChatMessage[] {
    const messages: ChatMessage[] = []

    // Add system instructions if present
    // Note: Always include for all providers - they handle it appropriately:
    // - OpenAI: Accepts system message in every request
    // - Gemini: Extracts it and uses it when creating Chat instance
    // - Anthropic: Accepts system message in every request
    if (context.systemInstructions) {
      messages.push({ role: 'system', content: context.systemInstructions })
    }

    // All providers currently need full history
    // - OpenAI uses previous_response_id for optimization (handled in provider)
    // - Gemini uses Chat class for optimization (handled in provider)
    // - Anthropic needs full history every time
    messages.push(...context.messageHistory)

    return messages
  }
  
  /**
   * Get session state for a context
   * Session ID is derived from contextId (internal plumbing, not part of MainFlowContext)
   */
  getSessionState(context: MainFlowContext): ProviderSessionState {
    const key = this.getSessionKey(context)
    let state = this.sessions.get(key)
    if (!state) {
      state = {}
      this.sessions.set(key, state)
    }
    return state
  }

  /**
   * Clear session state (useful for provider switching)
   */
  clearSessionState(context: MainFlowContext): void {
    const key = this.getSessionKey(context)
    this.sessions.delete(key)
  }

  /**
   * Get session key for a context
   * Uses contextId as the session ID (internal plumbing)
   */
  private getSessionKey(context: MainFlowContext): string {
    return context.contextId
  }
}

/**
 * LLM Service - main service class
 */
class LLMService {
  private contextManager: ContextManager
  
  constructor() {
    this.contextManager = new ContextManager()
  }
  
  /**
   * Send a message to the LLM and get a response
   *
   * This is the main entry point for all LLM interactions.
   * It handles provider selection, API keys, context management,
   * event emission, and error handling.
   */
  async chat(request: LLMServiceRequest): Promise<LLMServiceResponse> {
    const { message, tools, context, nodeId, responseSchema, overrideProvider, overrideModel, skipHistory } = request

    // Use override provider/model if specified (for nodes like intentRouter)
    const provider = overrideProvider || context.provider
    const model = overrideModel || context.model

    // 1. Get provider adapter
    const providerAdapter = providers[provider]
    if (!providerAdapter) {
      return {
        text: '',
        updatedContext: context,
        error: `Unknown provider: ${provider}`
      }
    }

    // 2. Get API key
    const apiKey = await getProviderKey(provider)
    if (!apiKey) {
      return {
        text: '',
        updatedContext: context,
        error: `Missing API key for provider: ${provider}`
      }
    }

    // 3. Clone context and optionally add user message
    let updatedContext: MainFlowContext
    if (skipHistory) {
      // For stateless calls (like intentRouter), don't modify history
      updatedContext = context
    } else {
      // Normal case: add user message to history
      updatedContext = {
        ...context,
        messageHistory: [...context.messageHistory, { role: 'user', content: message }]
      }
    }

    // 4. Get messages to send (provider-specific logic)
    let messagesToSend: ChatMessage[]
    if (skipHistory) {
      // For stateless calls, just send the message directly
      messagesToSend = [{ role: 'user', content: message }]
    } else {
      messagesToSend = this.contextManager.getMessagesToSend(updatedContext)
    }

    // 5. Set up event handlers - uses existing sendFlowEvent!
    // Pass skipHistory flag to suppress chunk events for internal calls
    const eventHandlers = this.createEventHandlers(context, nodeId, provider, model, skipHistory)

    // 6. Call provider
    let response = ''

    try {
      await new Promise<void>(async (resolve, reject) => {
        try {
          const streamOpts = {
            apiKey,
            model,
            messages: messagesToSend,
            sessionId: context.contextId, // Use contextId as sessionId (internal plumbing)
            onChunk: (text: string) => {
              // Skip duplicate final chunks (some providers send the full response as a final chunk)
              if (text === response) {
                return
              }
              response += text
              eventHandlers.onChunk(text)
            },
            onDone: () => resolve(),
            onError: (error: string) => reject(new Error(error)),
            onTokenUsage: eventHandlers.onTokenUsage
          }
          
          // Use agentStream if:
          // 1. We have tools to use, OR
          // 2. We have a responseSchema (structured output), OR
          // 3. Both
          const needsAgentStream = (tools && tools.length > 0) || responseSchema

          if (needsAgentStream && providerAdapter.agentStream) {
            // Use agentStream with tools and/or structured output
            await providerAdapter.agentStream({
              ...streamOpts,
              tools: tools || [],
              responseSchema,
              toolMeta: { requestId: context.contextId }, // Use contextId as requestId
              onToolStart: eventHandlers.onToolStart,
              onToolEnd: eventHandlers.onToolEnd,
              onToolError: eventHandlers.onToolError
            })
          } else {
            // Use regular chatStream (no tools, no structured output)
            await providerAdapter.chatStream(streamOpts)
          }
        } catch (e: any) {
          reject(e)
        }
      })
    } catch (e: any) {
      const errorMessage = e.message || String(e)
      console.error(`[LLMService] Error during chat:`, errorMessage)

      // Send error event to UI
      eventHandlers.onError(errorMessage)

      return {
        text: '',
        updatedContext,
        error: errorMessage
      }
    }
    
    // 7. Add assistant response to context (unless skipHistory)
    let finalContext: MainFlowContext
    if (skipHistory) {
      // For stateless calls, don't modify context
      finalContext = updatedContext
    } else {
      // Normal case: add assistant response to history
      finalContext = {
        ...updatedContext,
        messageHistory: [...updatedContext.messageHistory, { role: 'assistant', content: response }]
      }
    }

    return {
      text: response,
      updatedContext: finalContext
    }
  }
  
  /**
   * Create event handlers that use the existing sendFlowEvent function
   *
   * This ensures events work exactly like they do now:
   * - Globally registered in renderer
   * - Survive HMR
   * - Work when agent view is not active
   *
   * @param skipHistory - If true, suppresses chunk events (for internal/stateless calls like intentRouter)
   */
  private createEventHandlers(_context: MainFlowContext, _nodeId: string, provider: string, model: string, skipHistory?: boolean) {
    // Note: requestId and nodeId are available in context but not currently used
    // They're kept as parameters for future use (e.g., tracking per-node events)

    return {
      onChunk: (text: string) => {
        // Don't emit chunk events for internal/stateless calls (like intentRouter)
        // These are not part of the user conversation and shouldn't be displayed
        if (!skipHistory) {
          useMainStore.getState().feHandleChunk(text)
        }
      },

      onTokenUsage: (usage: TokenUsage) => {
        useMainStore.getState().feHandleTokenUsage(provider, model, usage)
      },

      onToolStart: (ev: { callId?: string; name: string }) => {
        useMainStore.getState().feHandleToolStart(ev.name)
      },

      onToolEnd: (ev: { callId?: string; name: string }) => {
        useMainStore.getState().feHandleToolEnd(ev.name)
      },

      onToolError: (ev: { callId?: string; name: string; error: string }) => {
        useMainStore.getState().feHandleToolError(ev.name, ev.error)
      },

      onError: (error: string) => {
        useMainStore.getState().feHandleError(error)
      }
    }
  }
  
  /**
   * Get the context manager (for advanced use cases)
   */
  getContextManager(): ContextManager {
    return this.contextManager
  }
}

// Singleton instance
export const llmService = new LLMService()

