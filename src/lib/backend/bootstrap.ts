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
import { initHydrationEvents, useHydration } from '../../store/hydration'
import { useBackendBinding } from '../../store/binding'
import { useLoadingOverlay } from '../../store/loadingOverlay'

let client: BackendClient | null = null

export function getBackendClient(): BackendClient | null {
  return client
}


export function bootstrapBackendFromPreload(): void {
  const boot = window.wsBackend?.getBootstrap?.()
  if (!boot || !boot.url) {
    return
  }

  client = new BackendClient({
    url: boot.url,
    token: boot.token,
    onOpen: () => {
      useBackendBinding.setState({ windowId: boot.windowId })
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

  // Workspace binding
  client.subscribe('workspace.attached', (p: any) => {
    console.log('[bootstrap] workspace.attached received:', p)
    const workspaceId = (p?.workspaceId || p?.id || p?.root || null) as string | null
    const root = (p?.root || (typeof workspaceId === 'string' ? workspaceId : null)) as string | null
    console.log('[bootstrap] Setting attached:', { windowId: boot.windowId, workspaceId, root, attached: !!workspaceId })

    console.log('[bootstrap] Before setState, current state:', useBackendBinding.getState())
    useBackendBinding.setState({ windowId: boot.windowId, workspaceId, root, attached: !!workspaceId })
    console.log('[bootstrap] After setState, new state:', useBackendBinding.getState())

    // Force loading overlay to recompute
    setTimeout(() => {
      console.log('[bootstrap] Forcing loadingOverlay recompute')
      useLoadingOverlay.getState()._recompute()
    }, 100)
  })

  client.connect()

  // Hydrate initial workspace state (in case already attached before renderer started)
  setTimeout(async () => {
    try {
      await (client as any).whenReady?.(5000)
      const ws: any = await client!.rpc('workspace.get', {})
      console.log('[bootstrap] workspace.get response:', ws)
      if (ws?.ok && ws.root) {
        console.log('[bootstrap] Hydrating workspace state:', { root: ws.root, attached: true })
        useBackendBinding.setState({
          windowId: boot.windowId,
          workspaceId: ws.root,
          root: ws.root,
          attached: true
        })
      }
    } catch (e) {
      console.error('[bootstrap] Failed to hydrate workspace state:', e)
    }
  }, 0)


  // After ready, perform ping and init handshake
  setTimeout(async () => {
    try {
      const anyClient = client as any
      if (anyClient.whenReady) {
        await anyClient.whenReady(5000)
      }
      await client!.rpc('handshake.ping', { windowId: boot.windowId })

      await client!.rpc('handshake.init', {
        windowId: boot.windowId,
        capabilities: { client: 'renderer', features: ['terminal', 'agent-pty', 'workspace', 'flow'] }
      })

      // workspace.attached/ready notifications are the canonical binding signals.
      // Now that the notification pipeline is fixed, we no longer need an RPC
      // fallback snapshot here.

      // After subscriptions are in place, perform a conservative active-flow check so
      // the runtime state is seeded if a flow is already running for this workspace.
      setTimeout(async () => {
        try {

          const active = await FlowService.getActive()
          if (Array.isArray(active) && active.length > 0) {
            // Seed minimal runtime state so UI doesn't show "stopped"
            const id = active[0]
            try { useFlowRuntime.getState().setRequestId(id) } catch {}
            try { useFlowRuntime.getState().setStatus('running') } catch {}
            // Seed currently executing/paused nodes from backend snapshot so UI highlights instantly
            try {
              const snap: any = await FlowService.getStatus(id)
              if (snap && !Array.isArray(snap)) {
                const rt = useFlowRuntime.getState()
                if (snap.status === 'waitingForInput') { try { rt.setStatus('waitingForInput') } catch {} }
                if (Array.isArray(snap.activeNodeIds)) {
                  for (const nid of snap.activeNodeIds) {
                    try { rt.handleEvent({ type: 'nodeStart', nodeId: nid, requestId: id } as any) } catch {}
                  }
                }
                if (snap.pausedNodeId) {
                  try { rt.handleEvent({ type: 'waitingForInput', nodeId: snap.pausedNodeId, requestId: id } as any) } catch {}
                }
              }
            } catch {}

          } else {
            // No active flow detected - this is normal during app startup
            // The flow will be started by initializeSession after the session is loaded
          }
        } catch (e) {
          // Swallow active-flow check errors; UI will hydrate on next execution
        }
      }, 200)
    } catch (err) {
      // Swallow init handshake errors; reconnect logic will retry
    }
  }, 250)
}


