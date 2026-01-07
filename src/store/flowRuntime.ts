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
  inputPrompt?: string | null
  isToolInput?: boolean
  nodeState: Record<string, NodeExecState>
  selectedSessionId?: string | null
  isHydrating: boolean
  stoppedRequestId?: string  // Track the requestId of the stopped flow to ignore its cleanup events

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
    inputPrompt: null,
    isToolInput: false,
    nodeState: {},
    selectedSessionId: null,
    isHydrating: false,
    stoppedRequestId: undefined,

    setStatus: (s) => set({ status: s }),
    setRequestId: (id) => set({ requestId: id }),
    setSessionScope: (id) => set({ selectedSessionId: id ?? null }),
    setIsHydrating: (b) => set({ isHydrating: !!b }),
    reset: () => set({ status: 'stopped', requestId: undefined, lastEventAt: undefined, pausedNode: null, inputPrompt: null, isToolInput: false, nodeState: {}, stoppedRequestId: undefined }),

    handleEvent: (ev) => {
      // Minimal state machine driven by backend flow events
      const t = (ev?.type || '').toLowerCase()
      const now = Date.now()

      // Session scoping: drop events that don't match the currently selected session (when provided)
      // EXCEPT for 'done' and 'error' events which should always be processed to reset the UI
      const currentSid = get().selectedSessionId
      const evSid = (ev as any)?.sessionId as string | undefined
      if (currentSid && evSid && evSid !== currentSid && t !== 'done' && t !== 'error') {
        console.log('[handleEvent] Dropping event due to session mismatch:', t, 'current:', currentSid, 'event:', evSid)
        return
      }

      // Once flow is stopped, ignore cleanup events from the same flow
      // This prevents cleanup events (nodeEnd, etc.) from resetting the UI back to 'running'
      // But allow events from a NEW flow (different requestId) to start
      const currentStatus = get().status
      const currentRid = get().requestId
      const stoppedRid = get().stoppedRequestId
      if (currentStatus === 'stopped' && t !== 'done' && t !== 'error' && ev?.requestId === stoppedRid) {
        console.log('[handleEvent] Ignoring cleanup event from stopped flow:', t, 'requestId:', ev.requestId)
        return
      }

      // Drop or adopt events when requestId mismatches
      // Always process 'done' and 'error' events to reset UI
      // Adopt 'start-ish' events to switch to a new flow
      if (currentRid && ev?.requestId && ev.requestId !== currentRid) {
        const isStartish = t === 'nodestart' || t === 'chunk' || t === 'waitingforinput'
        const isTerminal = t === 'done' || t === 'error'

        console.log('[handleEvent] RequestId mismatch:', t, 'current:', currentRid, 'event:', ev.requestId, 'isTerminal:', isTerminal, 'isStartish:', isStartish)

        if (isTerminal) {
          // Always process terminal events for the current flow
          // Don't switch to a different requestId
          if (ev.requestId !== currentRid) {
            console.log('[handleEvent] Dropping terminal event due to requestId mismatch')
            return
          }
        } else if (isStartish) {
          // Adopt start-ish events to switch to a new flow
          if (t === 'waitingforinput') {
            set({
              requestId: ev.requestId,
              status: 'waitingForInput',
              lastEventAt: now,
              pausedNode: (ev.nodeId as string) || null,
              inputPrompt: (ev as any).prompt || null,
              isToolInput: !!(ev as any).isTool
            })
          } else {
            set({ requestId: ev.requestId, status: 'running', lastEventAt: now, pausedNode: null, inputPrompt: null, isToolInput: false })
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
        const newState: any = { lastEventAt: now }
        if (get().status === 'waitingForInput') {
          newState.status = 'running'
          newState.inputPrompt = null
          newState.pausedNode = null
          newState.isToolInput = false
        }
        set(newState)
        return
      }

      if (t === 'toolerror') {
        const newState: any = { lastEventAt: now }
        if (get().status === 'waitingForInput') {
          newState.status = 'running'
          newState.inputPrompt = null
          newState.pausedNode = null
          newState.isToolInput = false
        }
        set(newState)
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
        set({
          status: 'waitingForInput',
          requestId: ev.requestId,
          lastEventAt: now,
          pausedNode: nodeId,
          inputPrompt: (ev as any).prompt || null,
          isToolInput: !!(ev as any).isTool
        })
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
        const rid = get().requestId
        set({ status: 'stopped', lastEventAt: now, pausedNode: null, stoppedRequestId: rid })
        return
      }

      if (t === 'done') {
        console.log('[handleEvent] Processing done event, resetting UI')
        const rid = get().requestId
        set({ status: 'stopped', requestId: undefined, lastEventAt: now, pausedNode: null, inputPrompt: null, isToolInput: false, stoppedRequestId: rid })
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
import { type StoreApi, type UseBoundStore } from 'zustand'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __flowRuntimeStore = (hotData.flowRuntimeStore || createFlowRuntimeStore()) as UseBoundStore<StoreApi<FlowRuntimeState>>

export const useFlowRuntime = __flowRuntimeStore

if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => {
    data.flowRuntimeStore = __flowRuntimeStore
  })
}

export function initFlowRuntimeEvents(): void {
  try {
    // 1) Subscribe FIRST to avoid missing in-flight events
    FlowService.onEvent((ev) => {
      try {
        console.log('[flowRuntime] Received event:', ev.type, 'requestId:', ev.requestId)
        useFlowRuntime.getState().handleEvent(ev)
      } catch (e) {
        console.error('[flowRuntime] Error handling event:', e)
        // Swallow runtime event errors; UI will reflect state on next successful event
      }
    })

      // 2) Then snapshot current runtime and seed state (race-proof)
      ; (async () => {
        try {
          const active = await FlowService.getActive()
          if (!Array.isArray(active) || active.length === 0) {
            return
          }
          const rid = active[0]
          const snap: any = await FlowService.getStatus(rid)
          if (snap && !Array.isArray(snap)) {
            const rt = useFlowRuntime.getState()
            try { rt.setRequestId(rid) } catch { }
            if (snap.status === 'waitingForInput') { try { rt.setStatus('waitingForInput') } catch { } }
            if (Array.isArray(snap.activeNodeIds)) {
              for (const nid of snap.activeNodeIds) {
                try { rt.handleEvent({ type: 'nodeStart', nodeId: nid, requestId: rid } as any) } catch { }
              }
            }
            if (snap.pausedNodeId) {
              try { rt.handleEvent({ type: 'waitingforinput', nodeId: snap.pausedNodeId, requestId: rid, isTool: snap.isToolInput } as any) } catch { }
            }
          }
        } catch { }
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
      try { useFlowRuntime.getState().reset() } catch { }
      return
    }
    const rid = active[0]
    const snap: any = await FlowService.getStatus(rid)
    if (snap && !Array.isArray(snap)) {
      const rt = useFlowRuntime.getState()
      try { rt.setRequestId(rid) } catch { }
      if (snap.status === 'waitingForInput') {
        try { rt.setStatus('waitingForInput') } catch { }
        if (snap.pausedNodeId) {
          try { rt.handleEvent({ type: 'waitingforinput', nodeId: snap.pausedNodeId, requestId: rid, isTool: snap.isToolInput } as any) } catch { }
        }
      } else if (snap.status === 'running') {
        try { rt.setStatus('running') } catch { }
        if (Array.isArray(snap.activeNodeIds)) {
          for (const nid of snap.activeNodeIds) {


            try { rt.handleEvent({ type: 'nodeStart', nodeId: nid, requestId: rid } as any) } catch { }
          }
        }
      } else {
        try { rt.setStatus('stopped') } catch { }
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
    try { rt.setIsHydrating(true) } catch { }
    // Single-shot status refresh to avoid spamming flow.getActive with repeated retries.
    await refreshFlowRuntimeStatus()
  } catch (e) {
    // Ignore refresh failures; caller will see latest runtime status on next event.
  } finally {
    try { rt.setIsHydrating(false) } catch { }
  }
}
