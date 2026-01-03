/**
 * Flow Execution Engine V2 - Main Entry Point
 *
 * Clean, function-based execution with explicit inputs/outputs
 */

import type { WebContents } from 'electron'
import { FlowScheduler } from './scheduler'
import { emitFlowEvent } from './events'
import type { FlowExecutionArgs, MessagePart } from './types'
import type { Session, SessionMessage } from '../store/types.js'
import { startTimelineListener } from './timeline-event-handler.js'

// Active flow schedulers
const activeFlows = new Map<string, FlowScheduler>()

// Track timeline listeners per request to clean up on cancel/error
const timelineListeners = new Map<string, () => void>()



/**
 * Execute a flow
 */
export async function executeFlow(
  wc: WebContents | undefined,
  args: FlowExecutionArgs
): Promise<{ ok: boolean; error?: string }> {
  console.log('[executeFlow] begin', { requestId: args.requestId, sessionId: (args as any)?.sessionId, nodes: (args as any)?.flowDef?.nodes?.length, edges: (args as any)?.flowDef?.edges?.length })

  const { requestId, flowDef } = args

  // Start timeline event listener
  const unsubscribe = startTimelineListener(requestId, args)
  timelineListeners.set(requestId, unsubscribe)

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
    try { timelineListeners.get(requestId)?.() } catch {}
    timelineListeners.delete(requestId)
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
  userInput: string | MessagePart[],
  userInputContext?: unknown
): Promise<{ ok: boolean; error?: string }> {
  console.log('[resumeFlow] Called with:', { requestId, hasUserInput: !!userInput })

  const scheduler = activeFlows.get(requestId)

  if (!scheduler) {
    console.error('[resumeFlow] Scheduler not found for requestId:', requestId)
    return { ok: false, error: 'Flow not found or not active' }
  }

  try {
    // Resolve the promise that the userInput node is awaiting
    // The scheduler knows which node is waiting - just resolve any waiting input
    // Provider/model will be refreshed from session context before next node execution
    let finalInput = userInput
    
    // Only append context if it's non-empty and not just null/undefined
    const hasMeaningfulContext = userInputContext !== undefined && 
                                userInputContext !== null && 
                                (typeof userInputContext !== 'object' || Object.keys(userInputContext as any).length > 0)

    if (hasMeaningfulContext) {
      const contextStr = `\n\n---\n\n[attached_context]\n${safeStringify(userInputContext)}`
      if (typeof userInput === 'string') {
        finalInput = `${userInput}${contextStr}`
      } else if (Array.isArray(userInput)) {
        // If multi-modal, append a text part with the context
        finalInput = [...userInput, { type: 'text', text: contextStr }]
      }
    }

    // Add user message to session timeline
    const sessionId = scheduler.getSessionId()
    const workspaceId = scheduler.getWorkspaceId()

    console.log('[resumeFlow] Adding user message to timeline:', { sessionId, workspaceId })

    if (sessionId && workspaceId) {
      const { getSessionService } = await import('../services/index.js')
      const { broadcastWorkspaceNotification } = await import('../backend/ws/broadcast.js')

      const sessionService = getSessionService()

      console.log('[resumeFlow] Got sessionService:', !!sessionService)

      const sessions = sessionService.getSessionsFor({ workspaceId })
      const sessionIndex = sessions.findIndex((s: Session) => s.id === sessionId)
      const session: Session | undefined = sessionIndex >= 0 ? sessions[sessionIndex] : undefined

      console.log('[resumeFlow] Found session:', !!session, 'sessions count:', sessions.length)

      if (session) {
        // Create user message item
        const userMessageItem: SessionMessage = {
          type: 'message',
          id: `msg-${Date.now()}`,
          role: 'user',
          content: finalInput as any,
          timestamp: Date.now()
        }

        console.log('[resumeFlow] Created user message item:', userMessageItem.id)

        // Add to session timeline
        const updatedItems = [...(session.items || []), userMessageItem]
        const updatedSession: Session = {
          ...session,
          items: updatedItems,
          updatedAt: Date.now(),
          lastActivityAt: Date.now(),
        }

        const updatedSessions = [...sessions]
        updatedSessions[sessionIndex] = updatedSession

        sessionService.setSessionsFor({ workspaceId, sessions: updatedSessions })
        sessionService.saveSessionFor({ workspaceId, sessionId }, false)

        console.log('[resumeFlow] Broadcasting user message to renderer')

        // Broadcast to renderer
        broadcastWorkspaceNotification(workspaceId, 'session.timeline.delta', {
          op: 'message',
          item: userMessageItem
        })

        console.log('[resumeFlow] User message added to timeline successfully')
      } else {
        console.warn('[resumeFlow] Session not found for sessionId:', sessionId)
      }
    } else {
      console.warn('[resumeFlow] Missing sessionId or workspaceId:', { sessionId, workspaceId })
    }

    console.log('[resumeFlow] Calling scheduler.resolveAnyWaitingUserInput')
    scheduler.resolveAnyWaitingUserInput(finalInput)
    console.log('[resumeFlow] resolveAnyWaitingUserInput returned successfully')

    return { ok: true }
  } catch (e: any) {
    const error = e?.message || String(e)
    console.error('[resumeFlow] Error:', error)
    console.error('[resumeFlow] Stack:', e?.stack)
    emitFlowEvent(requestId, { type: 'error', error })
    return { ok: false, error }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ error: 'userInputContext-unserializable' })
  }
}

/** Update provider/model for an active flow's main context, if present */
export function updateActiveFlowProviderModelForSession(sessionId: string, provider?: string, model?: string): void {
  try {
    if (!sessionId) return
    // activeFlows is keyed by requestId, not sessionId, so we need to find the scheduler by session
    for (const scheduler of activeFlows.values()) {
      if (scheduler.getSessionId() === sessionId) {
        console.log('[updateActiveFlowProviderModelForSession] Updating scheduler for session:', sessionId, { provider, model })
        scheduler.updateProviderModel(provider, model)
        return
      }
    }
    console.log('[updateActiveFlowProviderModelForSession] No active flow found for session:', sessionId)
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
    const sessionId = scheduler.getSessionId()
    try { emitFlowEvent(requestId, { type: 'done', sessionId }) } catch {}

    // Allow the synchronous onFlowEvent handlers to run before cleanup
    // (EventEmitter dispatch is synchronous)
    try { timelineListeners.get(requestId)?.() } catch {}
    timelineListeners.delete(requestId)
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

/**
 * Get the active flows map (for RPC handlers)
 */
export function getActiveFlows(): Map<string, FlowScheduler> {
  return activeFlows
}
