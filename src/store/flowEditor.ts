import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { shouldHydrateFlowGraphChange, type FlowGraphChangedEventPayload } from '../../shared/flowGraph'

interface FlowEditorStore {
  availableTemplates: any[]
  templatesLoaded: boolean
  selectedTemplate: string


  setTemplates: (templates: any[], loaded: boolean, selected: string) => void

  hydrateTemplates: () => Promise<void>



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


  setTemplates: (templates, loaded, selected) => set({
    availableTemplates: templates,
    templatesLoaded: loaded,
    selectedTemplate: selected
  }),


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



  // Load a template and refresh state
  loadTemplate: async (templateId: string) => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    try {
      const res: any = await client.rpc('flowEditor.loadTemplate', { templateId })
      if (res?.ok) {
        // Refresh templates and graph
        await get().hydrateTemplates()


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

  // Graph changed - templates may also change (e.g., template load/save/delete)
  client.subscribe('flowEditor.graph.changed', async (payload: FlowGraphChangedEventPayload) => {
    const reason = payload?.reason ?? 'unknown'
    if (!shouldHydrateFlowGraphChange(reason)) {
      console.log('[flowEditor] Ignoring flowEditor.graph.changed event with reason:', reason)
      return
    }
    await hydrateFromBackend(`graph-changed:${reason}`)

  })
}

