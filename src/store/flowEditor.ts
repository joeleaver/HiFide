import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'

interface FlowEditorStore {
  availableTemplates: any[]
  templatesLoaded: boolean
  selectedTemplate: string
  graphVersion: number // Increment to trigger re-hydration in components
  currentGraph: { nodes: any[]; edges: any[] } | null
  isHydratingGraph: boolean // Track graph hydration for loading overlay

  setTemplates: (templates: any[], loaded: boolean, selected: string) => void
  incrementGraphVersion: () => void
  hydrateTemplates: () => Promise<void>
  fetchGraph: () => Promise<{ ok: boolean; nodes?: any[]; edges?: any[] }>
  requestGraphHydration: () => void

  // All flow editor actions - components should call these instead of RPC
  loadTemplate: (templateId: string) => Promise<{ ok: boolean }>
  saveAsProfile: (params: { name: string; library: string; nodes: any[]; edges: any[] }) => Promise<{ ok: boolean }>
  deleteProfile: (name: string) => Promise<{ ok: boolean }>
  createNewFlowNamed: (name: string) => Promise<{ ok: boolean }>
  setGraph: (params: { nodes: any[]; edges: any[] }) => Promise<void>
}

export const useFlowEditor = create<FlowEditorStore>((set, get) => ({
  availableTemplates: [],
  templatesLoaded: false,
  selectedTemplate: '',
  graphVersion: 0,
  currentGraph: null,
  isHydratingGraph: false,

  setTemplates: (templates, loaded, selected) => set({
    availableTemplates: templates,
    templatesLoaded: loaded,
    selectedTemplate: selected
  }),

  incrementGraphVersion: () => set((s) => ({ graphVersion: s.graphVersion + 1 })),

  hydrateTemplates: async () => {
    const client = getBackendClient()
    if (!client) return

    try {
      const t: any = await client.rpc('flowEditor.getTemplates', {})
      if (t?.ok) {
        set({
          availableTemplates: t.templates || [],
          templatesLoaded: !!t.templatesLoaded,
          selectedTemplate: t.selectedTemplate || ''
        })
      }
    } catch {}
  },

  // Fetch graph from main store - components should call this instead of RPC directly
  fetchGraph: async () => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    // Use timeout to prevent infinite hangs
    const RPC_TIMEOUT = 5000
    const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
      return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ])
    }

    try {
      set({ isHydratingGraph: true })
      console.log('[flowEditor] Fetching graph from main store')
      const g: any = await withTimeout(client.rpc('flowEditor.getGraph', {}), RPC_TIMEOUT)

      if (g === null) {
        console.warn('[flowEditor] Graph fetch timed out')
        set({ isHydratingGraph: false })
        return { ok: false }
      }

      console.log('[flowEditor] Graph response:', { ok: g?.ok, nodeCount: g?.nodes?.length, edgeCount: g?.edges?.length })

      if (g?.ok) {
        const nodes = Array.isArray(g.nodes) ? g.nodes : []
        const edges = Array.isArray(g.edges) ? g.edges : []
        set({ currentGraph: { nodes, edges }, isHydratingGraph: false })
        return { ok: true, nodes, edges }
      }
      set({ isHydratingGraph: false })
      return { ok: false }
    } catch (e) {
      console.error('[flowEditor] Error fetching graph:', e)
      set({ isHydratingGraph: false })
      return { ok: false }
    }
  },

  // Trigger graph hydration - components should call this instead of RPC directly
  requestGraphHydration: () => {
    set((s) => ({ graphVersion: s.graphVersion + 1 }))
  },

  // Load a template and refresh state
  loadTemplate: async (templateId: string) => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    try {
      const res: any = await client.rpc('flowEditor.loadTemplate', { templateId })
      if (res?.ok) {
        // Refresh templates and graph
        await get().hydrateTemplates()
        await get().fetchGraph()
        set((s) => ({ graphVersion: s.graphVersion + 1 }))
      }
      return res
    } catch {
      return { ok: false }
    }
  },

  // Save current graph as a new profile
  saveAsProfile: async ({ name, library, nodes, edges }: { name: string; library: string; nodes: any[]; edges: any[] }) => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    try {
      // Sync graph to backend first
      await client.rpc('flowEditor.setGraph', { nodes, edges })
      const res: any = await client.rpc('flowEditor.saveAsProfile', { name, library })
      if (res?.ok) {
        // Refresh templates
        await get().hydrateTemplates()
      }
      return res
    } catch {
      return { ok: false }
    }
  },

  // Delete a profile
  deleteProfile: async (name: string) => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    try {
      const res: any = await client.rpc('flowEditor.deleteProfile', { name })
      if (res?.ok) {
        // Refresh templates and graph
        await get().hydrateTemplates()
        await get().fetchGraph()
        set((s) => ({ graphVersion: s.graphVersion + 1 }))
      }
      return res
    } catch {
      return { ok: false }
    }
  },

  // Create a new flow with a given name
  createNewFlowNamed: async (name: string) => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    try {
      const res: any = await client.rpc('flowEditor.createNewFlowNamed', { name })
      if (res?.ok) {
        // Refresh templates and graph
        await get().hydrateTemplates()
        await get().fetchGraph()
        set((s) => ({ graphVersion: s.graphVersion + 1 }))
      }
      return res
    } catch {
      return { ok: false }
    }
  },

  // Set graph in backend (for auto-save)
  setGraph: async ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
    const client = getBackendClient()
    if (!client) return

    try {
      await client.rpc('flowEditor.setGraph', { nodes, edges })
    } catch {}
  }
}))

export function initFlowEditorEvents(): void {
  const client = getBackendClient()
  if (!client) return

  // Helper to fetch and set templates from backend
  const hydrateFromBackend = async (source: string) => {
    try {
      console.log(`[flowEditor] Hydrating templates (${source})`)
      const t: any = await client.rpc('flowEditor.getTemplates', {})
      if (t?.ok) {
        console.log(`[flowEditor] Templates loaded (${source}):`, {
          count: t.templates?.length || 0,
          selectedTemplate: t.selectedTemplate,
          templatesLoaded: t.templatesLoaded
        })
        useFlowEditor.getState().setTemplates(
          t.templates || [],
          !!t.templatesLoaded,
          t.selectedTemplate || ''
        )
      }
    } catch (e) {
      console.warn(`[flowEditor] Templates hydration failed (${source}):`, e)
    }
  }

  // Initial hydration - fetch templates on startup
  // Use multiple attempts with increasing delays to handle timing issues
  // where the main process may still be loading templates
  setTimeout(() => hydrateFromBackend('initial-100ms'), 100)
  setTimeout(() => hydrateFromBackend('initial-500ms'), 500)
  setTimeout(() => hydrateFromBackend('initial-1500ms'), 1500)

  // Graph changed - increment version to trigger component re-hydration
  client.subscribe('flowEditor.graph.changed', async () => {
    await hydrateFromBackend('graph-changed')
    // Increment version to signal components to re-hydrate graph
    useFlowEditor.getState().incrementGraphVersion()
  })
}

