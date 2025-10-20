/**
 * Flow Editor Local Store (Renderer-only)
 *
 * Holds live editing state for the flow graph to keep interactions responsive
 * and avoid IPC churn. Hydrates from main on load/session change and
 * debounced-saves a normalized graph back to main.
 */

import { create } from 'zustand'
import { useDispatch } from './index'

// Lightweight debounce to avoid pulling in lodash
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let t: any
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}

export type LocalFlowNode = any
export type LocalFlowEdge = any

interface FlowEditorLocalState {
  nodes: LocalFlowNode[]
  edges: LocalFlowEdge[]
  selection: Record<string, boolean>
  layout: Record<string, { x: number; y: number; w?: number; h?: number }>

  // Actions
  hydrateFromMain: (graph: { nodes: LocalFlowNode[]; edges: LocalFlowEdge[] }) => void
  setNodes: (nodes: LocalFlowNode[]) => void
  setEdges: (edges: LocalFlowEdge[]) => void
  reset: () => void
  saveDebounced: () => void
}


export const useFlowEditorLocal = create<FlowEditorLocalState>((set, get) => {
  // Debounced saver uses closure over get(); dispatch grabbed at call time
  const doSave = debounce(() => {
    const { nodes, edges } = get()
    const dispatch = useDispatch()
    // Sync latest UI graph to main store (main will handle persistence/normalization)
    dispatch('feSetNodes', { nodes })
    dispatch('feSetEdges', { edges })
  }, 500)

  return {
    nodes: [],
    edges: [],
    selection: {},
    layout: {},

    hydrateFromMain: (graph) => {
      set({ nodes: graph.nodes || [], edges: graph.edges || [] })
    },

    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),

    reset: () => set({ nodes: [], edges: [], selection: {}, layout: {} }),

    saveDebounced: () => { doSave() },
  }
})

