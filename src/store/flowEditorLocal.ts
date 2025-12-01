/**
 * Flow Editor Local Store (Renderer-only)
 *
 * Single source of truth for flow graph editing state in the renderer.
 * Automatically hydrates from main process and debounced-saves back.
 * Components should ONLY read from this store, never manage their own state.
 */

import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'

export type LocalFlowNode = any
export type LocalFlowEdge = any

interface FlowEditorLocalState {
  nodes: LocalFlowNode[]
  edges: LocalFlowEdge[]
  isHydrated: boolean  // Track if we've loaded from main at least once

  // Actions
  setNodes: (nodes: LocalFlowNode[]) => void
  setEdges: (edges: LocalFlowEdge[]) => void
  reset: () => void
}


export const useFlowEditorLocal = create<FlowEditorLocalState>((set, get) => ({
  nodes: [],
  edges: [],
  isHydrated: false,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  reset: () => set({ nodes: [], edges: [], isHydrated: false }),
}))

// Debounced save to backend
let saveTimeout: any = null
let savesEnabled = true

const scheduleSave = () => {
  if (!savesEnabled) return

  if (saveTimeout) clearTimeout(saveTimeout)

  saveTimeout = setTimeout(async () => {
    if (!savesEnabled) return
    const { nodes, edges } = useFlowEditorLocal.getState()
    try {
      await getBackendClient()?.rpc('flowEditor.setGraph', { nodes, edges })
    } catch (e) {
      console.error('[flowEditorLocal] Save failed:', e)
    }
  }, 500)
}

// Subscribe to node/edge changes and auto-save
useFlowEditorLocal.subscribe((state, prevState) => {
  // Only save if hydrated and nodes/edges actually changed
  if (state.isHydrated && (state.nodes !== prevState.nodes || state.edges !== prevState.edges)) {
    scheduleSave()
  }
})

/**
 * Initialize event listeners for flow editor
 * Call this once on app startup
 */
export async function initFlowEditorLocalEvents(): Promise<void> {
  const client = getBackendClient()
  if (!client) {
    console.warn('[flowEditorLocal] No backend client available')
    return
  }

  // Wait for client to be ready before subscribing
  try {
    await (client as any).whenReady?.(7000)
  } catch (e) {
    console.error('[flowEditorLocal] Client not ready:', e)
    return
  }

  // Subscribe to graph changes from main process
  client.subscribe('flowEditor.graph.changed', async () => {
    console.log('[flowEditorLocal] Graph changed event received, fetching from main')

    // Temporarily disable saves during hydration
    savesEnabled = false
    if (saveTimeout) clearTimeout(saveTimeout)

    try {
      const result: any = await client.rpc('flowEditor.getGraph', {})
      if (result?.ok && result.nodes && result.edges) {
        console.log('[flowEditorLocal] Hydrating graph:', {
          nodeCount: result.nodes.length,
          edgeCount: result.edges.length
        })

        // Log full node object to see what we're receiving
        if (result.nodes.length > 0) {
          const sample = result.nodes[0]
          console.log('[flowEditorLocal] Full sample node from main:', JSON.stringify(sample, null, 2))

          // Also log a readFile node if present
          const readFileNode = result.nodes.find((n: any) => n.id?.startsWith('readFile'))
          if (readFileNode) {
            console.log('[flowEditorLocal] Full readFile node from main:', JSON.stringify(readFileNode, null, 2))
          }
        }

        useFlowEditorLocal.setState({
          nodes: result.nodes,
          edges: result.edges,
          isHydrated: true
        })
      }
    } catch (e) {
      console.error('[flowEditorLocal] Failed to fetch graph:', e)
    } finally {
      // Re-enable saves after a short delay
      setTimeout(() => { savesEnabled = true }, 750)
    }
  })

  // Initial hydration on startup
  console.log('[flowEditorLocal] Triggering initial hydration')
  client.publish('flowEditor.graph.changed', {})
}

