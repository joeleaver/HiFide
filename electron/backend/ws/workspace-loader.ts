/**
 * Consolidated workspace loading logic
 * 
 * This module provides a single function that handles all workspace loading scenarios:
 * 1. App startup with existing workspace (via handshake.init)
 * 2. File->Open menu replacing workspace in current window (via workspace.open)
 * 3. Opening workspace in new window (via workspace.open)
 */

import { getWorkspaceService, getSessionService, getFlowProfileService, getKanbanService, getKnowledgeBaseService } from '../../services/index.js'
import { sendWorkspaceSnapshot } from './snapshot.js'
import { setConnectionSelectedSessionId, transitionConnectionPhase } from './broadcast.js'
import type { RpcConnection } from './types.js'

export interface WorkspaceLoadOptions {
  /** The workspace root path to load */
  workspaceId: string

  /** The connection to bind and send notifications to */
  connection: RpcConnection

  /** Window ID for this workspace */
  windowId: string

  /** Whether to run in background (async) or block until complete */
  background?: boolean
}

/**
 * Load a workspace and bind it to a connection.
 * This is the single source of truth for workspace loading logic.
 *
 * Steps:
 * 1. Open workspace folder (creates .hifide directories if needed)
 * 2. Reload flow profiles (to pick up workspace-specific flows)
 * 3. Load sessions from disk
 * 4. Ensure at least one session exists (create if needed)
 * 5. Select most recently used session (if not already selected)
 * 6. Switch view to 'flow'
 * 7. Bind connection to workspace
 * 8. Send workspace.attached notification
 * 9. Send complete workspace snapshot
 * 10. Send workspace.ready notification
 */
export async function loadWorkspace(options: WorkspaceLoadOptions): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId, connection, windowId, background = false } = options

  const doLoad = async () => {
    try {
      // Transition to loading phase
      transitionConnectionPhase(connection, 'loading')

      const workspaceService = getWorkspaceService()
      const sessionService = getSessionService()
      const flowProfileService = getFlowProfileService()
      const kanbanService = getKanbanService()
      const kbService = getKnowledgeBaseService()

      // 1. Open workspace folder
      await workspaceService.openFolder(workspaceId, Number(windowId))

      // 2. Load flow profiles for this workspace
      try {
        await flowProfileService.initializeFor(workspaceId)
        console.log('[workspace-loader] Loaded flow profiles for workspace:', workspaceId)
      } catch (err) {
        console.error('[workspace-loader] Failed to load flow profiles:', err)
      }

      // 3. Load sessions from disk for this workspace
      await sessionService.loadSessionsFor({ workspaceId })

      // 4. Load kanban board for this workspace
      try {
        await kanbanService.kanbanLoadFor(workspaceId)
        console.log('[workspace-loader] Loaded kanban board for workspace:', workspaceId)
      } catch (err) {
        console.error('[workspace-loader] Failed to load kanban board:', err)
      }

      // 5. Load knowledge base items for this workspace
      try {
        const { listItems } = await import('../../store/utils/knowledgeBase.js')
        const items = await listItems(workspaceId)
        const itemsMap = items.reduce((acc, item) => {
          acc[item.id] = item
          return acc
        }, {} as Record<string, any>)
        kbService.setKbItems(itemsMap)
        console.log('[workspace-loader] Loaded KB items for workspace:', workspaceId, 'count:', items.length)
      } catch (err) {
        console.error('[workspace-loader] Failed to load KB items:', err)
      }

      // 6. Ensure at least one session exists
      const created = await sessionService.ensureSessionPresentFor({ workspaceId })

      // 7. Select a session if none is currently selected
      // Always check if a session is selected, regardless of whether we just created one
      const currentId = sessionService.getCurrentIdFor({ workspaceId })
      console.log('[workspace-loader] Current session ID:', currentId, 'created:', created)

      if (!currentId) {
        const sessions = sessionService.getSessionsFor({ workspaceId })
        console.log('[workspace-loader] No current session, selecting from', sessions.length, 'sessions')
        if (sessions.length > 0) {
          // Sort by lastActivityAt descending and select the most recent
          const sorted = [...sessions].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
          console.log('[workspace-loader] Selecting most recent session:', sorted[0].id, sorted[0].title)
          await sessionService.selectFor({ workspaceId, id: sorted[0].id })
          const afterId = sessionService.getCurrentIdFor({ workspaceId })
          console.log('[workspace-loader] Current session ID after selection:', afterId)
        }
      } else {
        console.log('[workspace-loader] Session already selected:', currentId)
      }

      // 7.5 Ensure PTY is attached for the selected session
      // This is a safeguard in case the session:selected event was missed
      const finalSessionId = sessionService.getCurrentIdFor({ workspaceId })
      if (finalSessionId) {
        try {
          const agentPty = await import('../../services/agentPty.js')
          await agentPty.getOrCreateAgentPtyFor(finalSessionId)
        } catch (err) {
          console.error('[workspace-loader] Failed to ensure PTY attachment:', err)
          // Don't fail workspace load if PTY attachment fails
        }
      }

      // 8. Send workspace.attached notification (canonical binding signal)
      // Note: Connection→workspace binding is now managed via window→workspace mapping in WorkspaceService
      connection.sendNotification('workspace.attached', {
        windowId: windowId || null,
        workspaceId,
        root: workspaceId
      })

      // 9. Send complete workspace snapshot (includes everything: sessions, flows, models, kanban, KB, etc.)
      const snapshotSent = await sendWorkspaceSnapshot(connection, workspaceId)

      if (snapshotSent) {
        // 10. Transition to ready phase and send workspace.ready notification
        transitionConnectionPhase(connection, 'ready')
        connection.sendNotification('workspace.ready', {
          windowId: windowId || null,
          workspaceId,
          root: workspaceId
        })

        // Update the selected session ID in connection metadata
        const curId = sessionService.getCurrentIdFor({ workspaceId })
        if (curId) {
          setConnectionSelectedSessionId(connection, curId)
        }

        // 10. Send loading.complete to signal renderer can hide loading screen
        connection.sendNotification('loading.complete', {
          workspaceId,
          sessionId: curId
        })

        // 11. Auto-start the flow
        try {
          console.log('[workspace-loader] Auto-starting flow for session:', curId)

          // Import flow execution
          const { executeFlow } = await import('../../flow-engine/index.js')
          const { getFlowGraphService } = await import('../../services/index.js')
          const { BrowserWindow } = await import('electron')
          const crypto = await import('crypto')

          const flowGraphService = getFlowGraphService()
          const graph = flowGraphService.getGraph({ workspaceId })

          if (graph.nodes && graph.nodes.length > 0 && curId) {
            const sessions = sessionService.getSessionsFor({ workspaceId })
            const session = sessions.find((s) => s.id === curId)

            if (session?.currentContext) {
              const requestId = crypto.randomUUID()
              const wc = BrowserWindow.fromId(Number(windowId))?.webContents

              console.log('[workspace-loader] Starting flow with requestId:', requestId)

              // Convert ReactFlow edges to flow-engine edges
              const { reactFlowEdgesToFlowEdges } = await import('../../services/flowConversion.js')
              const flowEdges = reactFlowEdgesToFlowEdges(graph.edges)

              // Start flow execution (don't await - it runs indefinitely)
              const includeThoughts = session.currentContext.includeThoughts ?? true
              const thinkingBudget = session.currentContext.thinkingBudget !== undefined
                ? session.currentContext.thinkingBudget
                : (includeThoughts ? 2048 : undefined)

              executeFlow(wc, {
                  includeThoughts,
                  ...(thinkingBudget !== undefined ? { thinkingBudget } : {}),
                requestId,
                flowDef: { nodes: graph.nodes, edges: flowEdges },
                sessionId: curId,
                workspaceId,
                initialContext: {
                  provider: session.currentContext.provider,
                  model: session.currentContext.model,
                  systemInstructions: session.currentContext.systemInstructions,
                  messageHistory: session.currentContext.messageHistory || [],
                },
              }).catch((err) => {
                console.error('[workspace-loader] Flow execution error:', err)
              })
            } else {
              console.log('[workspace-loader] Skipping auto-start: session has no context')
            }
          } else {
            console.log('[workspace-loader] Skipping auto-start: no flow loaded or no session')
          }
        } catch (err) {
          console.error('[workspace-loader] Failed to auto-start flow:', err)
          // Don't fail the workspace load if flow start fails
        }

        return { ok: true }
      } else {
        transitionConnectionPhase(connection, 'error')
        return { ok: false, error: 'Failed to build workspace snapshot' }
      }
    } catch (err: any) {
      transitionConnectionPhase(connection, 'error')
      connection.sendNotification('workspace.error', {
        root: workspaceId,
        error: err?.message || String(err)
      })
      return { ok: false, error: err?.message || String(err) }
    }
  }
  
  if (background) {
    // Run in background, return immediately
    doLoad().catch((err) => {
      console.error('[workspace-loader] Background load failed:', err)
    })
    return { ok: true }
  } else {
    // Block until complete
    return doLoad()
  }
}

