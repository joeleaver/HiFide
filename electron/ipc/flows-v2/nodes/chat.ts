/**
 * chat node
 *
 * Sends a message to the LLM and returns the response.
 * Supports tools via agentStream if provided.
 *
 * Inputs:
 * - context: Execution context from predecessor (REQUIRED)
 * - data: User message to send to LLM (REQUIRED)
 * - tools: Optional array of tool definitions
 *
 * Outputs:
 * - context: Updated context with message history
 * - data: Assistant's response
 */

import type { NodeFunction } from '../types'
import { providers } from '../../../core/state'
import { getProviderKey } from '../../../core/state'
import { sendFlowEvent } from '../events'

export const chatNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // Get node ID from config (added by scheduler)
  const nodeId = (config as any)?._nodeId || 'chat'

  // Get message from dataIn
  const message = dataIn || ''

  console.log(`[chat:${nodeId}] Received dataIn:`, typeof dataIn, dataIn?.substring?.(0, 100) || dataIn)
  console.log(`[chat:${nodeId}] Message after processing:`, message?.substring?.(0, 100) || message)

  if (!message) {
    console.error(`[chat:${nodeId}] No message provided! Returning error.`)
    return {
      context: contextIn,
      status: 'error',
      error: 'No message provided to chat node'
    }
  }

  // Get tools if provided
  const tools = inputs.tools

  // Debug: Log what tools we received
  console.log(`[chat:${nodeId}] Received tools:`, tools ? `${tools.length} tools: ${tools.map((t: any) => t.name).join(', ')}` : 'none')

  // Clone context to avoid mutating input
  const context = { ...contextIn, messageHistory: [...contextIn.messageHistory] }

  // Debug: Check if _wc and _requestId are present
  console.log(`[chat:${nodeId}] Context has _wc:`, !!context._wc, '_requestId:', context._requestId)

  // Add user message to context history
  context.messageHistory.push({ role: 'user', content: message })
  
  // Get provider adapter
  const providerAdapter = providers[context.provider]
  if (!providerAdapter) {
    return {
      context,
      status: 'error',
      error: `Unknown provider: ${context.provider}`
    }
  }

  // Get API key
  const apiKey = await getProviderKey(context.provider)
  if (!apiKey) {
    return {
      context,
      status: 'error',
      error: `Missing API key for provider: ${context.provider}`
    }
  }
  
  // Build messages to send
  const messagesToSend: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  const useNativeSession = (context.provider === 'openai' || context.provider === 'gemini')
  
  if (useNativeSession) {
    // Native session management - only send system on first message
    if (context.systemInstructions && context.messageHistory.length === 1) {
      messagesToSend.push({ role: 'system', content: context.systemInstructions })
    }
    // Only send current user input - provider handles history via sessionId
    messagesToSend.push({ role: 'user', content: message })
  } else {
    // Anthropic - send full history every time
    if (context.systemInstructions && context.messageHistory.length === 1) {
      messagesToSend.push({ role: 'system', content: context.systemInstructions })
    }
    messagesToSend.push(...context.messageHistory)
  }
  
  // Call LLM
  let response = ''

  try {
    await new Promise<void>(async (resolve, reject) => {
      try {
        const streamOpts = {
          apiKey,
          model: context.model,
          messages: messagesToSend,
          sessionId: context.sessionId,
          onChunk: (text: string) => {
            // Skip duplicate final chunks (some providers send the full response as a final chunk)
            // Check BEFORE adding to response
            if (text === response) {
              console.log('[chat] Skipping duplicate final chunk (full response)')
              return
            }

            response += text

            // Emit chunk event to renderer for streaming display
            if (context._wc && context._requestId) {
              sendFlowEvent(context._wc, context._requestId, {
                type: 'chunk',
                nodeId,
                text
              })
            }
          },
          onDone: () => { resolve() },
          onError: (error: string) => { reject(new Error(String(error))) },
          onTokenUsage: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
            console.log(`[chat:${nodeId}] Token usage:`, usage)
            // Send token usage event to renderer
            if (context._wc && context._requestId) {
              sendFlowEvent(context._wc, context._requestId, {
                type: 'tokenUsage',
                nodeId,
                provider: context.provider,
                model: context.model,
                usage
              })
            }
          }
        }

        if (tools && tools.length > 0 && providerAdapter.agentStream) {
          // Use agentStream with tools
          await providerAdapter.agentStream({
            ...streamOpts,
            tools,
            toolMeta: { requestId: context.sessionId },
            // Tool lifecycle callbacks
            onToolStart: (ev: { callId?: string; name: string }) => {
              if (context._wc && context._requestId) {
                sendFlowEvent(context._wc, context._requestId, {
                  type: 'toolStart',
                  nodeId,
                  toolName: ev.name,
                  callId: ev.callId
                })
              }
            },
            onToolEnd: (ev: { callId?: string; name: string }) => {
              if (context._wc && context._requestId) {
                sendFlowEvent(context._wc, context._requestId, {
                  type: 'toolEnd',
                  nodeId,
                  toolName: ev.name,
                  callId: ev.callId
                })
              }
            },
            onToolError: (ev: { callId?: string; name: string; error: string }) => {
              if (context._wc && context._requestId) {
                sendFlowEvent(context._wc, context._requestId, {
                  type: 'toolError',
                  nodeId,
                  toolName: ev.name,
                  error: ev.error,
                  callId: ev.callId
                })
              }
            }
          })
        } else {
          // Use regular chatStream
          await providerAdapter.chatStream(streamOpts)
        }
      } catch (e: any) {
        reject(new Error(e?.message || String(e)))
      }
    })
  } catch (e: any) {
    return {
      context: context,
      status: 'error',
      error: e?.message || String(e)
    }
  }

  // Add assistant response to context history
  context.messageHistory.push({ role: 'assistant', content: response })
  context.currentOutput = response

  return {
    context: context,
    data: response,
    status: 'success'
  }
}

