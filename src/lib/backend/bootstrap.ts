import { BackendClient } from './client'
import { initFlowRuntimeEvents, useFlowRuntime } from '../../store/flowRuntime'
import { FlowService } from '../../services/flow'
import { initChatTimelineEvents } from '../../store/chatTimeline'
import { initSessionUiEvents, useSessionUi } from '../../store/sessionUi'
import { initFlowContextsEvents } from '../../store/flowContexts'
import { initWorkspaceUiEvents } from '../../store/workspaceUi'
import { useBackendBinding } from '../../store/binding'

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
      console.log('[backend/bootstrap] onOpen: WebSocket connected, initializing stores')
      try { useBackendBinding.setState({ windowId: boot.windowId }) } catch {}

      // Ensure event subscriptions are attached (idempotent)
      try { initFlowRuntimeEvents() } catch {}
      try { initChatTimelineEvents() } catch {}
      try { initSessionUiEvents() } catch {}
      try { initFlowContextsEvents() } catch {}
      try { initWorkspaceUiEvents() } catch {}
    },
    onClose: () => {},
    onError: () => {},
    onNotify: (m, p) => {
      // Log every backend notification with window/workspace context for debugging
      try {
        const binding = useBackendBinding.getState()
        console.log('[ws-render] recv', m, {
          windowId: binding.windowId ?? null,
          workspaceId: binding.workspaceId ?? null,
        })
      } catch {}

      // Belt-and-suspenders: directly bridge critical session events to the per-window UI store.
      // This guarantees the HUD/overlay updates even if a method-specific subscription
      // (initSessionUiEvents) fails to attach for some reason.
      try {
        if (m === 'session.list.changed') {
          const list = Array.isArray(p?.sessions) ? (p.sessions as any[]) : []
          const currentId = (p?.currentId ?? null) as string | null
          try { useSessionUi.getState().__setSessions(list as any, currentId) } catch {}
        }
      } catch {}

      // Also handle canonical workspace attachment here to avoid any timing gaps in subscription setup.
      // Treat both workspace.attached and workspace.ready as signals that this window is bound.
      if (m === 'workspace.attached' || m === 'workspace.ready') {
        try {
          const workspaceId = (p?.workspaceId || p?.id || p?.root || null) as string | null
          const root = (p?.root || (typeof workspaceId === 'string' ? workspaceId : null)) as string | null
          useBackendBinding.setState({ windowId: boot.windowId, workspaceId, root, attached: !!workspaceId })
        } catch {}
      }
    }
  })
  client.connect()

  // Listen for canonical workspace attachment event (single source of truth)
  try {
    client.subscribe('workspace.attached', (p: any) => {
      try {
        const workspaceId = (p?.workspaceId || p?.id || p?.root || null) as string | null
        const root = (p?.root || (typeof workspaceId === 'string' ? workspaceId : null)) as string | null
        useBackendBinding.setState({ windowId: boot.windowId, workspaceId, root, attached: !!workspaceId })
      } catch {}
    })
  } catch {}


  // After ready, perform ping and init handshake
  setTimeout(async () => {
    try {
      const anyClient = client as any
      if (anyClient.whenReady) {
        await anyClient.whenReady(5000)
      }
      const ping = await client!.rpc('handshake.ping', { windowId: boot.windowId })

      const initRes = await client!.rpc('handshake.init', {
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


