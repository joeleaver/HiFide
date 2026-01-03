import util from 'node:util'
import { emitFlowEvent } from './events'
import type { ExecutionEvent } from './execution-events'

export interface ExecutionEventRouterOptions {
  requestId: string
  sessionId?: string
  abortSignal: AbortSignal
}

export type ExecutionEventRouter = (event: ExecutionEvent) => Promise<void>

export function createExecutionEventRouter(options: ExecutionEventRouterOptions): ExecutionEventRouter {
  const { requestId, sessionId, abortSignal } = options

  return async function handleExecutionEvent(event: ExecutionEvent): Promise<void> {
    if (abortSignal.aborted) {
      if (
        event.type === 'chunk' ||
        event.type === 'reasoning' ||
        event.type === 'tool_start' ||
        event.type === 'tool_end' ||
        event.type === 'tool_error' ||
        event.type === 'rate_limit_wait'
      ) {
        return
      }
      if (event.type === 'error') {
        return
      }
    }

    if (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'tool_error' || event.type === 'badge_add' || event.type === 'badge_update') {
      const tool = event.tool
      const name = tool?.toolName
      const callId = tool?.toolCallId
      const badgeId = event.badge?.badgeId
      console.log(`[FlowAPI] Event ${event.type} node=${event.nodeId} exec=${event.executionId} name=${name} callId=${callId} badgeId=${badgeId} provider=${event.provider} model=${event.model}`)
      console.log(util.inspect(event, { depth: null, colors: false, maxArrayLength: 200 }))
    }

    switch (event.type) {
      case 'chunk':
        if (event.chunk) {
          if (process.env.HF_FLOW_DEBUG === '1') {
            const brief = (event.chunk || '').slice(0, 60).replace(/\n/g, '\\n')
            console.log(`[FlowAPI] chunk node=${event.nodeId} exec=${event.executionId} len=${event.chunk.length} brief=${brief}`)
          }
          try { emitFlowEvent(requestId, { type: 'chunk', nodeId: event.nodeId, text: event.chunk, executionId: event.executionId, sessionId }) } catch {}
        }
        break

      case 'reasoning':
        if ((event as any).reasoning) {
          if (process.env.HF_FLOW_DEBUG === '1') {
            const brief = ((event as any).reasoning || '').slice(0, 60).replace(/\n/g, '\\n')
            console.log(`[FlowAPI] reasoning node=${event.nodeId} exec=${event.executionId} len=${(event as any).reasoning.length} brief=${brief}`)
          }
          try { emitFlowEvent(requestId, { type: 'reasoning', nodeId: event.nodeId, text: (event as any).reasoning, executionId: event.executionId, sessionId }) } catch {}
        }
        break

      case 'tool_start':
        if (event.tool) {
          try { emitFlowEvent(requestId, { type: 'toolStart', nodeId: event.nodeId, toolName: event.tool.toolName, callId: event.tool.toolCallId, toolArgs: event.tool.toolArgs, executionId: event.executionId, sessionId }) } catch {}
        }
        break

      case 'tool_end':
        if (event.tool) {
          try { emitFlowEvent(requestId, { type: 'toolEnd', nodeId: event.nodeId, toolName: event.tool.toolName, callId: event.tool.toolCallId, result: event.tool.toolResult, executionId: event.executionId, sessionId }) } catch {}
        }
        break

      case 'tool_error':
        if (event.tool) {
          try { emitFlowEvent(requestId, { type: 'toolError', nodeId: event.nodeId, toolName: event.tool.toolName, error: event.tool.toolError || 'Unknown error', callId: event.tool.toolCallId, executionId: event.executionId, sessionId }) } catch {}
        }
        break

      case 'usage':
        if (event.usage) {
          try { emitFlowEvent(requestId, { type: 'tokenUsage', nodeId: event.nodeId, provider: event.provider, model: event.model, usage: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens, cachedTokens: event.usage.cachedTokens || 0 }, cost: event.usage.cost, executionId: event.executionId, sessionId }) } catch {}
        }
        break

      case 'usage_breakdown':
        if ((event as any).usageBreakdown) {
          try {
            emitFlowEvent(requestId, {
              type: 'usageBreakdown',
              nodeId: event.nodeId,
              provider: event.provider,
              model: event.model,
              breakdown: (event as any).usageBreakdown,
              executionId: (event as any).executionId,
              sessionId
            })
          } catch (error) {
            console.warn('[FlowAPI] usageBreakdown emit failed:', error)
          }
        }
        break

      case 'done':
        try { emitFlowEvent(requestId, { type: 'done', sessionId }) } catch {}
        break

      case 'error':
        if (event.error) {
          try { emitFlowEvent(requestId, { type: 'error', nodeId: event.nodeId, executionId: event.executionId, error: event.error, sessionId }) } catch {}
        }
        break

      case 'rate_limit_wait':
        if (event.rateLimitWait && process.env.HF_FLOW_DEBUG === '1') {
          console.log('[ExecutionEvent] rate_limit_wait', event.rateLimitWait)
        }
        break

      case 'badge_add':
        if (event.badge) {
          try {
            emitFlowEvent(requestId, {
              type: 'badgeAdd',
              nodeId: event.nodeId,
              executionId: event.executionId,
              badgeId: event.badge.badgeId,
              badge: event.badge.data,
              sessionId
            })
          } catch {}
        }
        break

      case 'badge_update':
        if (event.badge) {
          try {
            emitFlowEvent(requestId, {
              type: 'badgeUpdate',
              nodeId: event.nodeId,
              executionId: event.executionId,
              badgeId: event.badge.badgeId,
              updates: event.badge.data,
              sessionId
            })
          } catch {}
        }
        break

      default:
        console.warn('[ExecutionEvent] Unknown event type:', event.type)
    }
  }
}

