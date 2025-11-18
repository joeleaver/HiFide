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

let inited = false
export function initFlowContextsEvents(): void {
  if (inited) return
  inited = true
  const client = getBackendClient(); if (!client) return

  try {
    client.subscribe('flow.contexts.changed', (p: any) => {
      try { useFlowContexts.getState().setContexts(p?.mainContext || null, p?.isolatedContexts || {}) } catch {}
    })
  } catch {}

  // Initial hydration (gate on workspace)
  ;(async () => {
    try { await (client as any).whenReady?.(5000) } catch {}
    try {
      const ws = await client.rpc('workspace.get', {})
      if (!ws?.ok || !ws.root) return
      const res = await client.rpc('flow.getContexts', {})
      if (res?.ok) {
        useFlowContexts.getState().setContexts(res.mainContext || null, res.isolatedContexts || {})
      }
    } catch {}
  })()

  // Rehydrate on workspace change
  try {
    const rehydrate = async () => {
      try { useFlowContexts.getState().setContexts(null, {}) } catch {}
      try {
        const res = await client.rpc('flow.getContexts', {})
        if (res?.ok) useFlowContexts.getState().setContexts(res.mainContext || null, res.isolatedContexts || {})
      } catch {}
    }
    client.subscribe('workspace.bound', rehydrate)
    client.subscribe('workspace.ready', rehydrate)
  } catch {}
}

