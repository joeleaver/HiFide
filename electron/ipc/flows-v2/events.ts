/**
 * Flow event helpers
 */

import type { WebContents } from 'electron'

export type FlowEvent =
  | { type: 'nodeStart'; nodeId: string }
  | { type: 'nodeEnd'; nodeId: string; durationMs?: number }
  | { type: 'io'; nodeId: string; data: string }
  | { type: 'error'; nodeId?: string; error: string }
  | { type: 'waitingForInput'; nodeId: string }
  | { type: 'done' }
  | { type: 'chunk'; nodeId: string; text: string }
  | { type: 'toolStart'; nodeId: string; toolName: string; callId?: string }
  | { type: 'toolEnd'; nodeId: string; toolName: string; callId?: string }
  | { type: 'toolError'; nodeId: string; toolName: string; error: string; callId?: string }
  | { type: 'intentDetected'; nodeId: string; intent: string }
  | { type: 'tokenUsage'; nodeId: string; provider: string; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }

export function sendFlowEvent(
  wc: WebContents | undefined,
  requestId: string,
  event: FlowEvent
): void {
  if (!wc) {
    console.error('[sendFlowEvent] No WebContents available!')
    return
  }

  const payload = {
    requestId,
    ...event
  }

  console.log('[sendFlowEvent]', {
    requestId,
    type: event.type,
    nodeId: (event as any).nodeId,
    data: (event as any).data?.substring?.(0, 100),
    text: (event as any).text?.substring?.(0, 100),
    fullPayload: payload
  })

  wc.send('flow:event', payload)
}

