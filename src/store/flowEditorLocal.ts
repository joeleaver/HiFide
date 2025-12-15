/**
 * Flow Editor Local Store (Renderer-only)
 *
 * Single source of truth for flow graph editing state in the renderer.
 * Automatically hydrates from main process and debounced-saves back.
 * Components should ONLY read from this store, never manage their own state.
 */

import { create } from 'zustand'
import { applyEdgeChanges, applyNodeChanges } from 'reactflow'
// NOTE: Do not import backend bootstrap at module-top.
// This store is imported in Jest tests, and bootstrap pulls in runtime-only modules.
// We lazy-resolve the backend client at save-time.
import type { BackendClient } from '../lib/backend/client'
import { decideHydrationStrategy } from './flowEditorLocalStrategy'
import { computeGraphSignature, fingerprintSanitizedGraph, sanitizeGraphSnapshot } from './flowEditorLocalTransforms'
import { shouldHydrateFlowGraphChange, type FlowGraphChangedEventPayload } from '../../shared/flowGraph'

export type LocalFlowNode = any
export type LocalFlowEdge = any

let lastGraphSignature = computeGraphSignature([], [])
let lastSavedGraphSignature = lastGraphSignature

// Debounced save to backend
let saveTimeout: any = null
let savesEnabled = true

const warnIfMutatingWhileSavesDisabled = (action: string) => {
  // In tests we allow mutations; we just disable background persistence.
  if (process.env.NODE_ENV === 'test') return false

  if (!savesEnabled) {
    // This can happen during hydration. Mutations during this window are risky because
    // they won't be persisted and can also fight with in-flight hydration updates.
    console.warn(`[flowEditorLocal] Mutation '${action}' while saves disabled (hydrating). Ignoring.`)
    return true
  }
  return false
}

interface FlowEditorLocalState {
  nodes: LocalFlowNode[]
  edges: LocalFlowEdge[]
  isHydrated: boolean  // Track if we've loaded from main at least once

  // Actions
  setNodes: (nodes: LocalFlowNode[]) => void
  setEdges: (edges: LocalFlowEdge[]) => void
  applyNodeChanges: (changes: unknown[]) => void
  applyEdgeChanges: (changes: unknown[]) => void
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
  updateNodeConfig: (nodeId: string, patch: Record<string, unknown>) => void
  addNode: (node: LocalFlowNode) => void
  removeNodeById: (nodeId: string) => void
  addEdge: (edge: LocalFlowEdge) => void
  removeEdgeById: (edgeId: string) => void
  reset: () => void
}


export const useFlowEditorLocal = create<FlowEditorLocalState>((set) => ({
  nodes: [],
  edges: [],
  isHydrated: false,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  applyNodeChanges: (changes) => {
    if (warnIfMutatingWhileSavesDisabled('applyNodeChanges')) return
    set((state) => ({
      nodes: applyNodeChanges(changes as any, state.nodes as any) as any,
    }))
  },

  applyEdgeChanges: (changes) => {
    if (warnIfMutatingWhileSavesDisabled('applyEdgeChanges')) return
    set((state) => ({
      edges: applyEdgeChanges(changes as any, state.edges as any) as any,
    }))
  },

  updateNodeData: (nodeId, patch) => {
    if (warnIfMutatingWhileSavesDisabled('updateNodeData')) return
    set((state) => ({
      nodes: state.nodes.map((n: any) =>
        n?.id === nodeId
          ? {
              ...n,
              data: {
                ...(n.data || {}),
                ...patch,
              },
            }
          : n,
      ),
    }))
  },

  updateNodeConfig: (nodeId, patch) => {
    if (warnIfMutatingWhileSavesDisabled('updateNodeConfig')) return
    set((state) => ({
      nodes: state.nodes.map((n: any) => {
        if (n?.id !== nodeId) return n
        const data = (n as any).data || {}
        const config = (data as any).config || {}
        return {
          ...n,
          data: {
            ...data,
            config: {
              ...config,
              ...patch,
            },
          },
        }
      }),
    }))
  },

  addEdge: (edge) => {
    if (warnIfMutatingWhileSavesDisabled('addEdge')) return
    set((state) => ({
      edges: [...(Array.isArray(state.edges) ? state.edges : []), edge],
    }))
  },

  removeEdgeById: (edgeId) => {
    if (warnIfMutatingWhileSavesDisabled('removeEdgeById')) return
    set((state) => ({
      edges: (Array.isArray(state.edges) ? state.edges : []).filter((e: any) => e?.id !== edgeId),
    }))
  },

  addNode: (node) => {
    if (warnIfMutatingWhileSavesDisabled('addNode')) return
    set((state) => ({
      nodes: [...(Array.isArray(state.nodes) ? state.nodes : []), node],
    }))
  },

  removeNodeById: (nodeId) => {
    if (warnIfMutatingWhileSavesDisabled('removeNodeById')) return
    set((state) => ({
      nodes: (Array.isArray(state.nodes) ? state.nodes : []).filter((n: any) => n?.id !== nodeId),
      edges: (Array.isArray(state.edges) ? state.edges : []).filter(
        (e: any) => e?.source !== nodeId && e?.target !== nodeId,
      ),
    }))
  },

  reset: () => set({ nodes: [], edges: [], isHydrated: false }),
}))

const scheduleSave = () => {
  if (!savesEnabled) return

  if (saveTimeout) clearTimeout(saveTimeout)

  saveTimeout = setTimeout(async () => {
    if (!savesEnabled) return
    const { nodes, edges } = useFlowEditorLocal.getState()
    const sanitizedGraph = sanitizeGraphSnapshot(nodes, edges)
    const pendingSignature = fingerprintSanitizedGraph(sanitizedGraph)
    try {
      const mod = (await import('../lib/backend/bootstrap')) as unknown as {
        getBackendClient: () => BackendClient | null
      }
      await mod.getBackendClient()?.rpc('flowEditor.setGraph', sanitizedGraph)
      lastSavedGraphSignature = pendingSignature
    } catch (e) {
      console.error('[flowEditorLocal] Save failed:', e)
    }
  }, 500)
}

// Subscribe to node/edge changes and auto-save
useFlowEditorLocal.subscribe((state, prevState) => {
  const nodesChanged = state.nodes !== prevState.nodes
  const edgesChanged = state.edges !== prevState.edges

  if (nodesChanged || edgesChanged) {
    lastGraphSignature = computeGraphSignature(state.nodes, state.edges)
  }

  // Only save if hydrated and nodes/edges actually changed
  if (state.isHydrated && (nodesChanged || edgesChanged)) {
    scheduleSave()
  }
})

// In Jest, module-level timeouts can outlive the test environment teardown.
// Ensure we don't run deferred backend imports/saves after teardown.
if (process.env.NODE_ENV === 'test') {
  // Prevent the module-level debounced save from trying to import backend bootstrap
  // after Jest has torn down the environment.
  savesEnabled = false
}

/**
 * Initialize event listeners for flow editor
 * Call this once on app startup
 */

export async function initFlowEditorLocalEvents(): Promise<void> {
  const mod = (await import('../lib/backend/bootstrap')) as unknown as {
    getBackendClient: () => BackendClient | null
  }
  const client = mod.getBackendClient()
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

  const hydrateFromBackend = async (trigger: string): Promise<void> => {
    console.log(`[flowEditorLocal] Hydration requested (${trigger}), fetching from main`)

    // Temporarily disable saves during hydration
    savesEnabled = false
    if (saveTimeout) clearTimeout(saveTimeout)

    try {
      const result: any = await client.rpc('flowEditor.getGraph', {})
      if (result?.ok && Array.isArray(result.nodes) && Array.isArray(result.edges)) {
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

        const sanitizedGraph = sanitizeGraphSnapshot(result.nodes, result.edges)
        const nextSignature = fingerprintSanitizedGraph(sanitizedGraph)
        const state = useFlowEditorLocal.getState()
        const localSignature = lastGraphSignature

        const decision = decideHydrationStrategy({
          isHydrated: state.isHydrated,
          localSignature,
          savedSignature: lastSavedGraphSignature,
          incomingSignature: nextSignature,
        })

        if (decision === 'skip-identical') {
          console.log('[flowEditorLocal] Skipping hydration – graph is unchanged compared to local store')
        } else if (decision === 'skip-stale-snapshot') {
          console.log('[flowEditorLocal] Skipping hydration – backend snapshot matches last save but local has newer edits')
        } else {
          useFlowEditorLocal.setState({
            nodes: sanitizedGraph.nodes,
            edges: sanitizedGraph.edges,
            isHydrated: true
          })
          lastGraphSignature = nextSignature
          lastSavedGraphSignature = nextSignature
        }
      }
    } catch (e) {
      console.error('[flowEditorLocal] Failed to fetch graph:', e)
    } finally {
      // Re-enable saves after a short delay
      setTimeout(() => { savesEnabled = true }, 750)
    }
  }

  // Subscribe to graph changes from main process
  client.subscribe('flowEditor.graph.changed', (payload: FlowGraphChangedEventPayload) => {
    const reason = payload?.reason ?? 'unknown'
    if (!shouldHydrateFlowGraphChange(reason)) {
      console.log('[flowEditorLocal] Ignoring flowEditor.graph.changed event with reason:', reason)
      return
    }
    void hydrateFromBackend(`graph-changed:${reason}`)
  })

  // Initial hydration on startup
  console.log('[flowEditorLocal] Triggering initial hydration')
  await hydrateFromBackend('initial')
}

