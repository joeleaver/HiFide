import { BackendClient } from './client'
import { initFlowRuntimeEvents, useFlowRuntime } from '../../store/flowRuntime'
import { FlowService } from '../../services/flow'
import { initChatTimelineEvents } from '../../store/chatTimeline'
import { initSessionUiEvents } from '../../store/sessionUi'
import { initFlowContextsEvents } from '../../store/flowContexts'
import { initWorkspaceUiEvents } from '../../store/workspaceUi'
import { initKnowledgeBaseEvents } from '../../store/knowledgeBase'
import { initKanbanEvents } from '../../store/kanban'
import { initAppBootEvents } from '../../store/appBoot'
import { initTerminalTabsEvents } from '../../store/terminalTabs'
import { initFlowEditorEvents } from '../../store/flowEditor'
import { initFlowEditorLocalEvents } from '../../store/flowEditorLocal'
import { initHydrationEvents, useHydration } from '../../store/hydration'
import { initUiEvents, reloadUiStateForWorkspace } from '../../store/ui'
import { useBackendBinding } from '../../store/binding'
import { useLoadingOverlay } from '../../store/loadingOverlay'

let client: BackendClient | null = null

export function getBackendClient(): BackendClient | null {
  return client
}


export function bootstrapBackendFromPreload(): void {
  // Read WebSocket bootstrap params directly from query string (no preload needed!)
  const params = new URLSearchParams(location.search)
  const url = params.get('wsUrl') || ''
  const token = params.get('wsToken') || ''
  const windowId = params.get('windowId') || ''

  if (!url) {
    return
  }

  client = new BackendClient({
    url,
    token,
    onOpen: () => {
      useBackendBinding.setState({ windowId })
      // Transition hydration from connecting → connected
      useHydration.getState().setPhase('connected')
    },
    onClose: () => {
      // Transition hydration to disconnected
      useHydration.getState().setPhase('disconnected')
    },
    onError: () => {},
    onNotify: () => {
      // Generic notification hook - currently unused
      // Individual subscriptions handle their own notifications
    }
  })

  // Initialize all event subscriptions once at app startup
  // BackendClient automatically re-attaches on reconnect

  // Initialize hydration first - it's the foundation for everything else
  initHydrationEvents()

  initFlowRuntimeEvents()
  initChatTimelineEvents()
  initSessionUiEvents()
  initFlowContextsEvents()
  initWorkspaceUiEvents()
  initKnowledgeBaseEvents()
  initKanbanEvents()
  initAppBootEvents()
  initTerminalTabsEvents()
  initFlowEditorEvents()
  initUiEvents()

  // Initialize flow editor local events (async - waits for client ready)
  void initFlowEditorLocalEvents()

  // Workspace binding
  client.subscribe('workspace.attached', (p: any) => {
    console.log('[bootstrap] workspace.attached received:', p)
    const workspaceId = (p?.workspaceId || p?.id || p?.root || null) as string | null
    const root = (p?.root || (typeof workspaceId === 'string' ? workspaceId : null)) as string | null
    console.log('[bootstrap] Setting attached:', { windowId, workspaceId, root, attached: !!workspaceId })

    console.log('[bootstrap] Before setState, current state:', useBackendBinding.getState())
    useBackendBinding.setState({ windowId, workspaceId, root, attached: !!workspaceId })
    console.log('[bootstrap] After setState, new state:', useBackendBinding.getState())

    // Reload UI state for the new workspace (workspace-scoped localStorage)
    reloadUiStateForWorkspace()

    // Force loading overlay to recompute
    setTimeout(() => {
      console.log('[bootstrap] Forcing loadingOverlay recompute')
      useLoadingOverlay.getState()._recompute()
    }, 100)
  })

  client.connect()

  // After connection is ready and all listeners are set up, signal to main process
  // that we're ready to receive workspace data
  setTimeout(async () => {
    try {
      const anyClient = client as any
      if (anyClient.whenReady) {
        await anyClient.whenReady(5000)
      }

      console.log('[bootstrap] All listeners ready, signaling window.ready to main process')

      // Signal that renderer is ready - main will begin loading workspace
      await client!.rpc('window.ready', { windowId })

      // After workspace loads, check for active flows
      setTimeout(async () => {
        try {
          const active = await FlowService.getActive()
          if (Array.isArray(active) && active.length > 0) {
            const id = active[0]
            try { useFlowRuntime.getState().setRequestId(id) } catch {}

            // Get snapshot first to determine correct status
            try {
              const snap: any = await FlowService.getStatus(id)
              if (snap && !Array.isArray(snap)) {
                const rt = useFlowRuntime.getState()

                // Set status based on snapshot (don't assume 'running')
                if (snap.status === 'waitingForInput') {
                  try { rt.setStatus('waitingForInput') } catch {}
                } else if (snap.status === 'running') {
                  try { rt.setStatus('running') } catch {}
                } else {
                  try { rt.setStatus('stopped') } catch {}
                }

                // Seed currently executing/paused nodes from backend snapshot so UI highlights instantly
                if (Array.isArray(snap.activeNodeIds)) {
                  for (const nid of snap.activeNodeIds) {
                    try { rt.handleEvent({ type: 'nodeStart', nodeId: nid, requestId: id } as any) } catch {}
                  }
                }
                if (snap.pausedNodeId) {
                  try { rt.handleEvent({ type: 'waitingforinput', nodeId: snap.pausedNodeId, requestId: id } as any) } catch {}
                }
              }
            } catch {}
          }
        } catch (e) {
          // Swallow active-flow check errors; UI will hydrate on next execution
        }
      }, 200)
    } catch (err) {
      console.error('[bootstrap] window.ready failed:', err)
    }
  }, 250)
}


