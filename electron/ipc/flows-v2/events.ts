/**
 * Flow event helpers
 */

import { EventEmitter } from 'events'

export type FlowEvent = (
  | { type: 'nodeStart'; nodeId: string }
  | { type: 'nodeEnd'; nodeId: string; durationMs?: number }
  | { type: 'io'; nodeId: string; data: string }
  | { type: 'error'; nodeId?: string; error: string }
  | { type: 'waitingForInput'; nodeId: string }
  | { type: 'done' }
  | { type: 'chunk'; nodeId: string; text: string }
  | { type: 'reasoning'; nodeId: string; text: string }
  | { type: 'toolStart'; nodeId: string; toolName: string; callId?: string; toolArgs?: any }
  | { type: 'toolEnd'; nodeId: string; toolName: string; callId?: string; result?: any }
  | { type: 'toolError'; nodeId: string; toolName: string; error: string; callId?: string }
  | { type: 'intentDetected'; nodeId: string; intent: string }
  | { type: 'tokenUsage'; nodeId: string; provider: string; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { type: 'usageBreakdown'; nodeId: string; provider: string; model: string; breakdown: any }
) & { executionId?: string; sessionId?: string }

/**
 * Flow event emitter - decouples flow execution from IPC layer
 *
 * Flow execution emits events, IPC layer subscribes and forwards to renderer
 */
class FlowEventEmitter extends EventEmitter {
  /**
   * Emit a flow event for a specific request
   */
  emitFlowEvent(requestId: string, event: FlowEvent): void {
    const payload = {
      requestId,
      ...event
    }

    // Emit on the requestId channel
    this.emit(requestId, payload)
    // Also emit on a broadcast channel so other subsystems (e.g., WS server) can forward without per-request wiring
    try { this.emit('broadcast', payload) } catch {}
  }

  /**
   * Subscribe to events for a specific request
   */
  onFlowEvent(requestId: string, listener: (event: FlowEvent & { requestId: string }) => void): () => void {
    this.on(requestId, listener)
    return () => this.off(requestId, listener)
  }

  /**
   * Clean up all listeners for a request (call when flow completes)
   */
  cleanup(requestId: string): void {
    this.removeAllListeners(requestId)
  }
}

// Global singleton instance
export const flowEvents = new FlowEventEmitter()

/**
 * Emit a flow event (replaces sendFlowEvent)
 */
export function emitFlowEvent(requestId: string, event: FlowEvent): void {
  flowEvents.emitFlowEvent(requestId, event)
}

