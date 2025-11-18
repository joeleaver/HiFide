/**
 * Flow Editor Local Store (Renderer-only)
 *
 * Holds live editing state for the flow graph to keep interactions responsive
 * and avoid IPC churn. Hydrates from main on load/session change and
 * debounced-saves a normalized graph back to main.
 */

import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'

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
  suspendSaving: (ms?: number) => void
  resumeSaving: () => void
}


export const useFlowEditorLocal = create<FlowEditorLocalState>((set, get) => {
  // Internal debounce + suppression controls
  let saveTimeout: any = null
  let savesEnabled = false
  const cancelPendingSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
      saveTimeout = null
    }
  }

  const scheduleSave = () => {
    if (!savesEnabled) {
      cancelPendingSave()
      return
    }
    cancelPendingSave()
    saveTimeout = setTimeout(async () => {
      if (!savesEnabled) return
      const { nodes, edges } = get()
      try {
        await getBackendClient()?.rpc('flowEditor.setGraph', { nodes, edges })
      } catch {}
    }, 500)
  }

  return {
    nodes: [],
    edges: [],
    selection: {},
    layout: {},

    hydrateFromMain: (graph) => {
      // Suppress outgoing saves during hydration to avoid overwriting freshly loaded graphs
      savesEnabled = false
      cancelPendingSave()
      set({ nodes: graph.nodes || [], edges: graph.edges || [] })
      // Re-enable saves shortly after hydration
      setTimeout(() => { savesEnabled = true }, 750)
    },

    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),

    reset: () => {
      cancelPendingSave()
      set({ nodes: [], edges: [], selection: {}, layout: {} })
    },

    saveDebounced: () => { scheduleSave() },

    suspendSaving: (ms?: number) => {
      savesEnabled = false
      cancelPendingSave()
      if (ms && ms > 0) {
        setTimeout(() => { savesEnabled = true }, ms)
      }
    },

    resumeSaving: () => { savesEnabled = true },
  }
})

