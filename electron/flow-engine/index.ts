/**
 * Flow Execution Engine V2 - Main Entry Point
 *
 * Clean, function-based execution with explicit inputs/outputs
 */

import type { WebContents } from 'electron'
import { FlowScheduler } from './scheduler'
import { emitFlowEvent } from './events'
import type { FlowExecutionArgs } from './types'
import { ServiceRegistry } from '../../services/base/ServiceRegistry'

// Active flow schedulers

const activeFlows = new Map<string, FlowScheduler>()

// Track persistence subscriptions per request to clean up on cancel/error
const persistSubs = new Map<string, () => void>()



/**
 * Execute a flow
 */
export async function executeFlow(
  wc: WebContents | undefined,
  args: FlowExecutionArgs
): Promise<{ ok: boolean; error?: string }> {
  console.log('[executeFlow] begin', { requestId: args.requestId, sessionId: (args as any)?.sessionId, nodes: (args as any)?.flowDef?.nodes?.length, edges: (args as any)?.flowDef?.edges?.length })

  const { requestId, flowDef } = args

  // Start timeline listening via SessionTimelineService
  const sessionTimelineService = ServiceRegistry.get<any>('sessionTimeline')
  if (sessionTimelineService) {
    const persistUnsubscribe = sessionTimelineService.startListeningToFlow(requestId, args)
    persistSubs.set(requestId, persistUnsubscribe)
  }

  emitFlowEvent(requestId, { type: 'io', nodeId: 'system', data: `[Flow Engine] Starting execution with ${flowDef.nodes.length} nodes, ${flowDef.edges.length} edges` })

  try {
    // Create scheduler
    const scheduler = new FlowScheduler(wc, requestId, flowDef, args)
    activeFlows.set(requestId, scheduler)

    // Execute - the flow runs until it hits a userInput node (which awaits indefinitely)
    // The promise will only resolve if there's an error or the flow is explicitly cancelled
    // Normal flows should NEVER complete - they wait at userInput nodes
    const result = await scheduler.execute()

    // Keep the flow active - don't emit "done" or clean up
    // The flow can still be resumed with user input
    return result
  } catch (e: any) {
    // Only clean up on actual errors
    activeFlows.delete(requestId)
    try { persistSubs.get(requestId)?.() } catch {}
    persistSubs.delete(requestId)
    // Do not cleanup global flow event forwarders; keep listening for this requestId
    const error = e?.message || String(e)
    console.error('[executeFlow] Error:', error)
    console.error('[executeFlow] Stack:', e?.stack)
    emitFlowEvent(requestId, { type: 'error', error })
    emitFlowEvent(requestId, { type: 'done' })
    return { ok: false, error }
  }
}

/**
 * Resume a paused flow with user input
 * Provider/model switching is handled by refreshMainContextFromStore() before each node execution
 */
export async function resumeFlow(
  _wc: WebContents | undefined,
  requestId: string,
  userInput: string
): Promise<{ ok: boolean; error?: string }> {
  console.log('[resumeFlow] Called with:', { requestId, userInputLength: userInput.length })

  const scheduler = activeFlows.get(requestId)

  if (!scheduler) {
    console.error('[resumeFlow] Scheduler not found for requestId:', requestId)
    return { ok: false, error: 'Flow not found or not active' }
  }

  try {
    // Resolve the promise that the userInput node is awaiting
    // The scheduler knows which node is waiting - just resolve any waiting input
    // Provider/model will be refreshed from session context before next node execution
    console.log('[resumeFlow] Calling scheduler.resolveAnyWaitingUserInput')
    scheduler.resolveAnyWaitingUserInput(userInput)

    return { ok: true }
  } catch (e: any) {
    const error = e?.message || String(e)
    console.error('[resumeFlow] Error:', error)
    emitFlowEvent(requestId, { type: 'error', error })
    return { ok: false, error }
  }
}

/** Update provider/model for an active flow's main context, if present */
export function updateActiveFlowProviderModelForSession(sessionId: string, provider?: string, model?: string): void {
  try {
    if (!sessionId) return
    const scheduler = activeFlows.get(sessionId)
    if (!scheduler) return
    scheduler.updateProviderModel(provider, model)
  } catch (e) {
    try { console.warn('[flows-v2] updateActiveFlowProviderModelForSession failed', e) } catch {}
  }
}


/**
 * Get an active flow scheduler (for backwards compatibility)
 * @deprecated Nodes should use store actions instead of accessing the scheduler directly
 */
export function getActiveFlow(requestId: string) {
  return activeFlows.get(requestId)
}

/**
 * Cancel a flow
 */
export async function cancelFlow(requestId: string): Promise<{ ok: boolean; error?: string }> {
  const scheduler = activeFlows.get(requestId)
  if (scheduler) {
    try {
      // Cooperatively cancel the running flow
      scheduler.cancel()
    } catch (e) {
      // Best-effort cancel
      console.warn('[cancelFlow] Error cancelling scheduler:', e)
    }

    // Remove from active set first to prevent new work scheduling
    activeFlows.delete(requestId)

    // Emit "done" BEFORE tearing down listeners so both the WS forwarder and
    // persistence subscriber can flush and notify renderers
    try { emitFlowEvent(requestId, { type: 'done' }) } catch {}

    // Allow the synchronous onFlowEvent handlers to run before cleanup
    // (EventEmitter dispatch is synchronous)
    try { persistSubs.get(requestId)?.() } catch {}
    persistSubs.delete(requestId)
    // Keep flowEvents listeners attached; renderer should always be listening

    return { ok: true }
  }
  return { ok: false, error: 'Flow not found' }
}





/**
 * Get snapshot/status for a specific flow (or null if not found)
 */
export function getFlowSnapshot(requestId: string): { requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null } | null {
  const scheduler = activeFlows.get(requestId)
  if (!scheduler) return null
  try {
    return scheduler.getSnapshot()
  } catch (e) {
    return null
  }
}

/**
 * Get snapshots for all active flows
 */
export function getAllFlowSnapshots(): Array<{ requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null }> {
  const out: Array<{ requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null }> = []
  for (const scheduler of activeFlows.values()) {
    try { out.push(scheduler.getSnapshot()) } catch {}
  }
  return out
}

/**
 * List active flow request IDs
 */
export function listActiveFlows(): string[] {
  return Array.from(activeFlows.keys())
}
