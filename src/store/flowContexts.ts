import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'

export interface FlowContextsSnapshot {
  requestId: string | null
  updatedAt: number
  mainContext: any | null
  isolatedContexts: Record<string, any>
}

interface FlowContextsState extends FlowContextsSnapshot {
  setContexts: (payload?: Partial<FlowContextsSnapshot> | null) => void
}

const initialSnapshot: FlowContextsSnapshot = {
  requestId: null,
  updatedAt: 0,
  mainContext: null,
  isolatedContexts: {},
}

function normalizePayload(payload?: Partial<FlowContextsSnapshot> | null): FlowContextsSnapshot {
  if (!payload) {
    return { ...initialSnapshot, updatedAt: 0 }
  }

  return {
    requestId: payload.requestId ?? null,
    updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now(),
    mainContext: payload.mainContext ?? null,
    isolatedContexts: payload.isolatedContexts ?? {},
  }
}

function createFlowContextsStore() {
  return create<FlowContextsState>((set) => ({
    ...initialSnapshot,
    setContexts: (payload) => set(normalizePayload(payload)),
  }))
}

// HMR reuse
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData: any = (import.meta as any).hot?.data || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __flowContextsStore: any = hotData.flowContextsStore || createFlowContextsStore()
export const useFlowContexts = __flowContextsStore
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => { data.flowContextsStore = __flowContextsStore })
}

export function initFlowContextsEvents(): void {
  const client = getBackendClient()
  if (!client) return

  client.subscribe('flow.contexts.changed', (payload: Partial<FlowContextsSnapshot> | null) => {
    useFlowContexts.getState().setContexts(payload)
  })
}

