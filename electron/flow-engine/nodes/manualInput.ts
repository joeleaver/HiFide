/**
 * manualInput node
 *
 * Emits a configured user message and appends it to the active context history.
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Outputs a configured message and appends it to the current context history.'
}

export const manualInputNode: NodeFunction = async (flow, _context, dataIn, inputs, config) => {
  let message = typeof config.message === 'string' ? config.message : ''

  if (!message && typeof dataIn === 'string') {
    message = dataIn
  } else if (!message && inputs?.has?.('data')) {
    const pulled = await inputs.pull('data')
    if (typeof pulled === 'string') {
      message = pulled
    }
  }

  const trimmed = message?.trim()
  if (!trimmed) {
    return {
      status: 'error',
      error: 'manualInput requires a non-empty message',
      context: flow.context.get(),
    }
  }

  flow.context.addMessage({ role: 'user', content: trimmed })

  return {
    context: flow.context.get(),
    data: trimmed,
    status: 'success' as const,
  }
}
