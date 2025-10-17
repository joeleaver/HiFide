/**
 * LLM Service - Unified abstraction layer for all LLM provider interactions
 *
 * This service handles:
 * - Provider selection and API key retrieval
 * - Message history management (scheduler owns the conversation state)
 * - Tool execution coordination
 * - Event emission (chunks, tokens, tool lifecycle)
 * - Error handling
 *
 * Benefits:
 * - Nodes are provider-agnostic (no provider-specific logic in nodes)
 * - Event handling is centralized (no duplication)
 * - Conversation management is unified (scheduler owns all state)
 * - Providers are stateless (just accept messages, stream responses)
 * - Easy to test (mock the service, not individual providers)
 * - Provider switching is built-in
 * - Easy to implement context windowing (scheduler controls what messages are sent)
 */

import type { MainFlowContext } from './types'
import type { AgentTool, TokenUsage, ChatMessage } from '../../providers/provider'
import { providers } from '../../core/state'
import { getProviderKey } from '../../core/state'

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
 * Format messages for OpenAI
 * OpenAI accepts our ChatMessage format directly (but we strip metadata)
 */
function formatMessagesForOpenAI(context: MainFlowContext): ChatMessage[] {
  const messages: ChatMessage[] = []

  // Add system instructions if present
  if (context.systemInstructions) {
    messages.push({ role: 'system', content: context.systemInstructions })
  }

  // Add all message history (strip metadata - OpenAI doesn't accept extra fields)
  messages.push(...context.messageHistory.map(m => ({
    role: m.role,
    content: m.content
  })))

  return messages
}

/**
 * Format messages for Anthropic
 * Anthropic separates system messages and uses prompt caching
 */
function formatMessagesForAnthropic(context: MainFlowContext): {
  system: any
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  // Extract system instructions
  const systemText = context.systemInstructions || ''

  // Use prompt caching for system prompt when available
  const system: any = systemText
    ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    : undefined

  // Convert message history (exclude system messages, only user/assistant)
  const messages = context.messageHistory
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

  return { system, messages }
}

/**
 * Format messages for Gemini
 * Gemini uses 'model' instead of 'assistant' and a different structure
 */
function formatMessagesForGemini(context: MainFlowContext): {
  systemInstruction: string
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
} {
  // Extract system instructions
  const systemInstruction = context.systemInstructions || ''

  // Convert message history to Gemini format
  const contents = context.messageHistory
    .filter(m => m.role !== 'system')
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.content }]
    }))

  return { systemInstruction, contents }
}

/**
 * LLM Service - main service class
 * Now stateless - all conversation state is managed by the scheduler
 */
class LLMService {
  constructor() {
    // No state needed - providers are stateless
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

    // 4. Format messages for the specific provider
    // llm-service is responsible for converting MainFlowContext to provider-specific format
    let formattedMessages: any

    if (skipHistory) {
      // For stateless calls (like intentRouter), just send the message directly
      // Format it appropriately for each provider
      if (provider === 'anthropic') {
        formattedMessages = {
          system: undefined,
          messages: [{ role: 'user' as const, content: message }]
        }
      } else if (provider === 'gemini') {
        formattedMessages = {
          systemInstruction: '',
          contents: [{ role: 'user', parts: [{ text: message }] }]
        }
      } else {
        // OpenAI and others
        formattedMessages = [{ role: 'user' as const, content: message }]
      }
    } else {
      // Normal case: format full conversation history for the provider
      if (provider === 'anthropic') {
        formattedMessages = formatMessagesForAnthropic(updatedContext)
      } else if (provider === 'gemini') {
        formattedMessages = formatMessagesForGemini(updatedContext)
      } else {
        // OpenAI and others
        formattedMessages = formatMessagesForOpenAI(updatedContext)
      }
    }

    // 5. Set up event handlers - uses existing sendFlowEvent!
    // Pass skipHistory flag to suppress chunk events for internal calls
    const eventHandlers = await this.createEventHandlers(context, nodeId, provider, model, skipHistory)

    // 6. Call provider with formatted messages
    let response = ''

    try {
      await new Promise<void>(async (resolve, reject) => {
        try {
          // Base stream options (common to all providers)
          const baseStreamOpts = {
            apiKey,
            model,
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

          // Provider-specific options
          let streamOpts: any
          if (provider === 'anthropic') {
            streamOpts = {
              ...baseStreamOpts,
              system: formattedMessages.system,
              messages: formattedMessages.messages
            }
          } else if (provider === 'gemini') {
            streamOpts = {
              ...baseStreamOpts,
              systemInstruction: formattedMessages.systemInstruction,
              contents: formattedMessages.contents
            }
          } else {
            // OpenAI and others use standard ChatMessage[] format
            streamOpts = {
              ...baseStreamOpts,
              messages: formattedMessages
            }
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
  private async createEventHandlers(_context: MainFlowContext, nodeId: string, provider: string, model: string, skipHistory?: boolean) {
    const { useMainStore } = await import('../../store/index.js')
    const store = useMainStore.getState()

    return {
      onChunk: (text: string) => {
        // Don't emit chunk events for internal/stateless calls (like intentRouter)
        // These are not part of the user conversation and shouldn't be displayed
        if (!skipHistory) {
          store.feHandleChunk(text)
        }
      },

      onTokenUsage: (usage: TokenUsage) => {
        store.feHandleTokenUsage(provider, model, usage)
      },

      onToolStart: (ev: { callId?: string; name: string; arguments?: any }) => {
        // Pass callId, nodeId and arguments so tool badges can be tracked and updated
        store.feHandleToolStart(ev.name, nodeId, ev.arguments, ev.callId)
      },

      onToolEnd: (ev: { callId?: string; name: string }) => {
        // Pass callId so we can find and update the specific badge
        store.feHandleToolEnd(ev.name, ev.callId)
      },

      onToolError: (ev: { callId?: string; name: string; error: string }) => {
        store.feHandleToolError(ev.name, ev.error, ev.callId)
      },

      onError: (error: string) => {
        store.feHandleError(error)
      }
    }
  }
}

// Singleton instance
export const llmService = new LLMService()

