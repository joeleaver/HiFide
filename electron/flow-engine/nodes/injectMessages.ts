/**
 * injectMessages node
 *
 * Injects a user/assistant pair into the active context history. Useful for
 * bootstrapping flows with canned instructions or exemplars.
 */

import crypto from 'node:crypto'
import type { NodeFunction, NodeExecutionPolicy, MainFlowContext } from '../types'

export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Injects a user/assistant pair into the context history.'
}

export const injectMessagesNode: NodeFunction = async (flow, _context, _dataIn, inputs, config) => {
  const contextManager = flow.context
  const userMessage = await resolveMessage(inputs, config.staticUserMessage, 'userMessage')
  const assistantMessage = await resolveMessage(inputs, config.staticAssistantMessage, 'assistantMessage')

  if (!userMessage) {
    return { status: 'error', error: 'User message is required for injectMessages', context: contextManager.get() }
  }
  if (!assistantMessage) {
    return { status: 'error', error: 'Assistant message is required for injectMessages', context: contextManager.get() }
  }

  const pinned = Boolean(config.pinned)
  const priority = typeof config.priority === 'number' ? config.priority : 50
  const mode = config.injectionMode === 'append' ? 'append' : 'prepend'

  const idPrefix = String(config.id || flow.nodeId || crypto.randomUUID())
  const pair = buildMessages(userMessage, assistantMessage, pinned, priority, idPrefix)

  const current = contextManager.get()
  const nextHistory = upsertPair(current.messageHistory || [], pair, mode)
  contextManager.replaceHistory(nextHistory)

  return {
    context: contextManager.get(),
    data: { userMessage, assistantMessage },
    status: 'success' as const,
  }
}

async function resolveMessage(inputs: any, fallback: any, handle: string): Promise<string> {
  if (inputs?.has?.(handle)) {
    const value = await inputs.pull(handle)
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim()
  }
  return ''
}

function buildMessages(
  userMessage: string,
  assistantMessage: string,
  pinned: boolean,
  priority: number,
  idPrefix: string
): [MainFlowContext['messageHistory'][number], MainFlowContext['messageHistory'][number]] {
  const baseMeta = pinned ? { pinned: true, priority } : undefined
  return [
    {
      role: 'user',
      content: userMessage,
      metadata: {
        id: `${idPrefix}-user`,
        ...(baseMeta || {}),
      }
    },
    {
      role: 'assistant',
      content: assistantMessage,
      metadata: {
        id: `${idPrefix}-assistant`,
        ...(baseMeta || {}),
      }
    }
  ]
}

function upsertPair(
  history: MainFlowContext['messageHistory'],
  pair: ReturnType<typeof buildMessages>,
  mode: 'append' | 'prepend'
): MainFlowContext['messageHistory'] {
  const [userMsg, assistantMsg] = pair
  const userIdx = history.findIndex(m => m.metadata?.id === userMsg.metadata?.id)
  const assistantIdx = history.findIndex(m => m.metadata?.id === assistantMsg.metadata?.id)

  if (userIdx >= 0 && assistantIdx >= 0) {
    const clone = [...history]
    clone[userIdx] = userMsg
    clone[assistantIdx] = assistantMsg
    return clone
  }

  if (mode === 'append') {
    return [...history, userMsg, assistantMsg]
  }
  return [userMsg, assistantMsg, ...history]
}
