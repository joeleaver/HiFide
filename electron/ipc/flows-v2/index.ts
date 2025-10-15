/**
 * Flow Execution Engine V2 - Main Entry Point
 * 
 * Clean, function-based execution with explicit inputs/outputs
 */

import type { IpcMain, WebContents } from 'electron'
import { BrowserWindow } from 'electron'
import { FlowScheduler } from './scheduler'
import { sendFlowEvent } from './events'
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

  console.log('[executeFlow] Starting flow execution:', { requestId, nodeCount: flowDef.nodes.length, edgeCount: flowDef.edges.length })
  sendFlowEvent(wc, requestId, { type: 'io', nodeId: 'system', data: `[Flow V2] Starting execution with ${flowDef.nodes.length} nodes, ${flowDef.edges.length} edges` })

  try {
    // Create scheduler
    const scheduler = new FlowScheduler(wc, requestId, flowDef, args)
    activeFlows.set(requestId, scheduler)

    // Execute - the flow will run continuously in a loop
    // It never "completes" - it just waits for user input at each iteration
    const result = await scheduler.execute()

    // If we get here, the flow has completed (shouldn't happen in a loop flow)
    activeFlows.delete(requestId)
    sendFlowEvent(wc, requestId, { type: 'done' })

    return result
  } catch (e: any) {
    activeFlows.delete(requestId)
    const error = e?.message || String(e)
    console.error('[executeFlow] Error:', error)
    console.error('[executeFlow] Stack:', e?.stack)
    sendFlowEvent(wc, requestId, { type: 'error', error })
    sendFlowEvent(wc, requestId, { type: 'done' })
    return { ok: false, error }
  }
}

/**
 * Resume a paused flow with user input
 */
export async function resumeFlow(
  wc: WebContents | undefined,
  requestId: string,
  userInput: string
): Promise<{ ok: boolean; error?: string }> {
  const scheduler = activeFlows.get(requestId)

  if (!scheduler) {
    return { ok: false, error: 'Flow not found or not active' }
  }

  try {
    // Just resolve the promise that the userInput node is awaiting
    // The flow never stopped - it's just waiting for this data
    // The nodeId is 'user-input' by convention (could be made configurable)
    scheduler.resolveUserInput('user-input', userInput)

    return { ok: true }
  } catch (e: any) {
    const error = e?.message || String(e)
    sendFlowEvent(wc, requestId, { type: 'error', error })
    return { ok: false, error }
  }
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
      console.log('[flow:run:v2] IPC handler called with args:', { requestId: args.requestId, hasFlowDef: !!args.flowDef })
      const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
      console.log('[flow:run:v2] WebContents available:', !!wc)
      const result = await executeFlow(wc, args)
      console.log('[flow:run:v2] Flow execution completed:', result)
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
    const scheduler = activeFlows.get(args.requestId)
    if (scheduler) {
      activeFlows.delete(args.requestId)
      const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
      sendFlowEvent(wc, args.requestId, { type: 'done' })
      return { ok: true }
    }
    return { ok: false, error: 'Flow not found' }
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

