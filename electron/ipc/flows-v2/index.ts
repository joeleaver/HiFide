/**
 * Flow Execution Engine V2 - Main Entry Point
 *
 * Clean, function-based execution with explicit inputs/outputs
 */

import type { IpcMain, WebContents } from 'electron'
import { BrowserWindow } from 'electron'
import { FlowScheduler } from './scheduler'
import { flowEvents, emitFlowEvent } from './events'
import type { FlowExecutionArgs } from './types'

// Active flow schedulers
const activeFlows = new Map<string, FlowScheduler>()

/**
 * Get the main window's web contents
 */
function getWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

/**
 * Execute a flow
 */
export async function executeFlow(
  wc: WebContents | undefined,
  args: FlowExecutionArgs
): Promise<{ ok: boolean; error?: string }> {
  const { requestId, flowDef } = args

  // Subscribe to flow events and forward to renderer
  // This decouples flow execution from IPC layer
  const unsubscribe = flowEvents.onFlowEvent(requestId, (event) => {
    if (wc) {
      // Sanitize event to ensure it's serializable
      // Do a JSON round-trip to strip out any non-serializable data
      try {
        const sanitized = JSON.parse(JSON.stringify(event))
        wc.send('flow:event', sanitized)
      } catch (error) {
        console.error('[executeFlow] Failed to serialize event:', error, event)
        // Send a minimal error event instead
        wc.send('flow:event', {
          requestId,
          type: 'error',
          error: 'Failed to serialize event data'
        })
      }
    }
  })

  emitFlowEvent(requestId, { type: 'io', nodeId: 'system', data: `[Flow V2] Starting execution with ${flowDef.nodes.length} nodes, ${flowDef.edges.length} edges` })

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
    unsubscribe()
    flowEvents.cleanup(requestId)
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
    activeFlows.delete(requestId)
    flowEvents.cleanup(requestId)
    emitFlowEvent(requestId, { type: 'done' })
    return { ok: true }
  }
  return { ok: false, error: 'Flow not found' }
}

/**
 * Register IPC handlers
 */
export function registerFlowHandlersV2(ipcMain: IpcMain): void {
  /**
   * Execute a flow
   */
  ipcMain.handle('flow:run:v2', async (_event, args: FlowExecutionArgs) => {
    try {
      const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
      const result = await executeFlow(wc, args)
      return result
    } catch (error: any) {
      console.error('[flow:run:v2] Error executing flow:', error)
      console.error('[flow:run:v2] Error stack:', error?.stack)
      return { ok: false, error: error?.message || String(error) }
    }
  })

  /**
   * Resume a paused flow
   */
  ipcMain.handle('flow:resume:v2', async (_event, args: { requestId: string; userInput: string }) => {
    const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
    return resumeFlow(wc, args.requestId, args.userInput)
  })

  /**
   * Cancel a flow
   */
  ipcMain.handle('flow:cancel:v2', async (_event, args: { requestId: string }) => {
    return cancelFlow(args.requestId)
  })

  /**
   * Get available tools for tool node configuration
   */
  ipcMain.handle('flows:getTools', async () => {
    try {
      const allTools = (globalThis as any).__agentTools || []
      // Return simplified tool info for UI (name and description only)
      return allTools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || ''
      }))
    } catch (error: any) {
      console.error('[flows:getTools] Error getting tools:', error)
      return []
    }
  })

}

