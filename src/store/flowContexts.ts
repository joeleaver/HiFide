import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'

interface FlowContextsState {
  mainContext: any | null
  isolatedContexts: Record<string, any>
  setContexts: (main: any | null, iso: Record<string, any>) => void
}

function createFlowContextsStore() {
  return create<FlowContextsState>((set) => ({
    mainContext: null,
    isolatedContexts: {},
    setContexts: (main, iso) => set({ mainContext: main || null, isolatedContexts: iso || {} }),
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

  // Context updates (incremental changes after initial hydration)
  client.subscribe('flow.contexts.changed', (p: any) => {
    useFlowContexts.getState().setContexts(p?.mainContext || null, p?.isolatedContexts || {})
  })

  // Initial hydration happens via workspace snapshot in hydration.ts
  // No RPC call needed here
}

