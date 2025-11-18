import { create } from 'zustand'
import { FlowService, type FlowEvent } from '../services/flow'

export type FlowStatus = 'stopped' | 'running' | 'waitingForInput'

export type NodeExecState = {
  status?: string
  cacheHit?: boolean
  durationMs?: number
  costUSD?: number
  detectedIntent?: string
  style?: { border?: string; boxShadow?: string }
}

interface FlowRuntimeState {
  status: FlowStatus
  requestId?: string
  lastEventAt?: number
  pausedNode?: string | null
  nodeState: Record<string, NodeExecState>
  selectedSessionId?: string | null
  isHydrating: boolean

  // Actions
  setStatus: (s: FlowStatus) => void
  setRequestId: (id?: string) => void
  setSessionScope: (id?: string | null) => void
  setIsHydrating: (b: boolean) => void
  reset: () => void
  handleEvent: (ev: FlowEvent) => void
}

function createFlowRuntimeStore() {
  return create<FlowRuntimeState>((set, get) => ({
    status: 'stopped',
    requestId: undefined,
    lastEventAt: undefined,
    pausedNode: null,
    nodeState: {},
    selectedSessionId: null,
    isHydrating: false,

    setStatus: (s) => set({ status: s }),
    setRequestId: (id) => set({ requestId: id }),
    setSessionScope: (id) => set({ selectedSessionId: id ?? null }),
    setIsHydrating: (b) => set({ isHydrating: !!b }),
    reset: () => set({ status: 'stopped', requestId: undefined, lastEventAt: undefined, pausedNode: null, nodeState: {} }),

    handleEvent: (ev) => {
      // Minimal state machine driven by backend flow events
      const t = (ev?.type || '').toLowerCase()
      const now = Date.now()

      // Session scoping: drop events that don't match the currently selected session (when provided)
      const currentSid = get().selectedSessionId
      const evSid = (ev as any)?.sessionId as string | undefined
      if (currentSid && evSid && evSid !== currentSid) {
        return
      }

      // Drop or adopt events when requestId mismatches; adopt on start-ish events
      const currentRid = get().requestId
      if (currentRid && ev?.requestId && ev.requestId !== currentRid) {
        const isStartish = t === 'nodestart' || t === 'chunk' || t === 'waitingforinput'
        if (isStartish) {
          if (t === 'waitingforinput') {
            set({ requestId: ev.requestId, status: 'waitingForInput', lastEventAt: now, pausedNode: (ev.nodeId as string) || null })
          } else {
            set({ requestId: ev.requestId, status: 'running', lastEventAt: now, pausedNode: null })
          }
        } else {
          return
        }
      }

      const updateNode = (nodeId: string, patch: Partial<NodeExecState>) => {
        const prev = get().nodeState[nodeId] || {}
        set({ nodeState: { ...get().nodeState, [nodeId]: { ...prev, ...patch } } })
      }


      if (t === 'nodestart') {
        const nodeId = ev.nodeId as string
        updateNode(nodeId, {
          status: 'executing',
          cacheHit: false,
          style: { border: '3px solid #60a5fa', boxShadow: '0 0 0 2px rgba(96,165,250,0.15)' }
        })
        set({ status: 'running', requestId: ev.requestId, lastEventAt: now })
        return
      }

      if (t === 'chunk') {
        const nodeId = ev.nodeId as string
        updateNode(nodeId, { status: 'streaming' })
        set({ status: 'running', requestId: ev.requestId, lastEventAt: now })
        return
      }

      if (t === 'toolstart') {
        set({ lastEventAt: now })
        return
      }

      if (t === 'toolend') {
        set({ lastEventAt: now })
        return
      }

      if (t === 'toolerror') {
        set({ lastEventAt: now })
        return
      }

      if (t === 'nodeend') {
        const nodeId = ev.nodeId as string
        const durationMs = ev.durationMs as number | undefined
        updateNode(nodeId, {
          status: 'completed',
          durationMs,
          style: { border: '3px solid #22c55e', boxShadow: '0 0 0 2px rgba(34,197,94,0.2)' }
        })
        set({ status: 'running', requestId: ev.requestId, lastEventAt: now })
        return
      }

      if (t === 'waitingforinput') {
        const nodeId = ev.nodeId as string
        updateNode(nodeId, {
          status: 'executing',
          style: { border: '3px solid #f59e0b', boxShadow: '0 0 0 2px rgba(245, 158, 11, 0.2)' }
        })
        set({ status: 'waitingForInput', requestId: ev.requestId, lastEventAt: now, pausedNode: nodeId })
        return
      }

      if (t === 'tokenusage') {
        const nodeId = ev.nodeId as string | undefined
        if (nodeId) {
          // We don't compute cost here; could be derived later if needed
          updateNode(nodeId, {})
        }
        set({ lastEventAt: now })
        return
      }

      if (t === 'intentdetected') {
        const nodeId = ev.nodeId as string
        updateNode(nodeId, { detectedIntent: ev.intent as string })
        set({ lastEventAt: now })
        return
      }

      if (t === 'error') {
        const nodeId = (ev.nodeId as string) || get().pausedNode || undefined
        if (nodeId) {
          updateNode(nodeId, { status: 'error', style: { border: '3px solid #ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.2)' } })
        }
        set({ status: 'stopped', lastEventAt: now, pausedNode: null })
        return
      }

      if (t === 'done') {
        set({ status: 'stopped', requestId: undefined, lastEventAt: now, pausedNode: null })
        return
      }

      // Any other activity implies running
      if (get().status !== 'running') {
        set({ status: 'running', requestId: ev.requestId, lastEventAt: now })
      } else {
        set({ lastEventAt: now })
      }
    }
  }))
}

// Reuse the same store across HMR reloads to keep event subscriptions writing to the same instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData: any = (import.meta as any).hot?.data || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __flowRuntimeStore: any = hotData.flowRuntimeStore || createFlowRuntimeStore()

export const useFlowRuntime = __flowRuntimeStore

if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => {
    data.flowRuntimeStore = __flowRuntimeStore
  })
}

let unsubscribe: (() => void) | null = null
export function initFlowRuntimeEvents(): void {
  // Re-subscribe idempotently (works across reconnects)
  try { unsubscribe?.() } catch {}
  try {
    // 1) Subscribe FIRST to avoid missing in-flight events
    unsubscribe = FlowService.onEvent((ev) => {
      try {
        useFlowRuntime.getState().handleEvent(ev)
      } catch (e) {
        // Swallow runtime event errors; UI will reflect state on next successful event
      }
    })

    // 2) Then snapshot current runtime and seed state (race-proof)
    ;(async () => {
      try {
        const active = await FlowService.getActive()
        if (!Array.isArray(active) || active.length === 0) {
          return
        }
        const rid = active[0]
        const snap: any = await FlowService.getStatus(rid)
        if (snap && !Array.isArray(snap)) {
          const rt = useFlowRuntime.getState()
          try { rt.setRequestId(rid) } catch {}
          if (snap.status === 'waitingForInput') { try { rt.setStatus('waitingForInput') } catch {} }
          if (Array.isArray(snap.activeNodeIds)) {
            for (const nid of snap.activeNodeIds) {
              try { rt.handleEvent({ type: 'nodeStart', nodeId: nid, requestId: rid } as any) } catch {}
            }
          }
          if (snap.pausedNodeId) {
            try { rt.handleEvent({ type: 'waitingForInput', nodeId: snap.pausedNodeId, requestId: rid } as any) } catch {}
          }
        }
      } catch {}
    })()
  } catch (e) {
    // Ignore subscribe failures; retry logic elsewhere will recover
  }
}

export async function refreshFlowRuntimeStatus(): Promise<void> {
  try {
    const active = await FlowService.getActive()
    if (!Array.isArray(active) || active.length === 0) {
      // No active flows – ensure clean stopped state
      try { useFlowRuntime.getState().reset() } catch {}
      return
    }
    const rid = active[0]
    const snap: any = await FlowService.getStatus(rid)
    if (snap && !Array.isArray(snap)) {
      const rt = useFlowRuntime.getState()
      try { rt.setRequestId(rid) } catch {}
      if (snap.status === 'waitingForInput') {
        try { rt.setStatus('waitingForInput') } catch {}
        if (snap.pausedNodeId) {
          try { rt.handleEvent({ type: 'waitingForInput', nodeId: snap.pausedNodeId, requestId: rid } as any) } catch {}
        }
      } else if (snap.status === 'running') {
        try { rt.setStatus('running') } catch {}
        if (Array.isArray(snap.activeNodeIds)) {
          for (const nid of snap.activeNodeIds) {


            try { rt.handleEvent({ type: 'nodeStart', nodeId: nid, requestId: rid } as any) } catch {}
          }
        }
      } else {
        try { rt.setStatus('stopped') } catch {}
      }
    }
  } catch (e) {
    // Ignore refresh errors; will retry or be triggered by next flow event
  }
}

export function refreshFlowRuntimeStatusSoon(delayMs = 250): void {
  setTimeout(() => { void refreshFlowRuntimeStatus() }, Math.max(0, delayMs))
}




export async function refreshFlowRuntimeStatusWithRetry(_delays: number[] = [150, 300, 600]): Promise<void> {
  const rt = useFlowRuntime.getState()
  try {
    try { rt.setIsHydrating(true) } catch {}
    // Single-shot status refresh to avoid spamming flow.getActive with repeated retries.
    await refreshFlowRuntimeStatus()
  } catch (e) {
    // Ignore refresh failures; caller will see latest runtime status on next event.
  } finally {
    try { rt.setIsHydrating(false) } catch {}
  }
}
