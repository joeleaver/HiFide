import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { useFlowEditorLocal } from './flowEditorLocal'
import { shouldHydrateFlowGraphChange, type FlowGraphChangedEventPayload } from '../../shared/flowGraph'

interface FlowEditorStore {
  availableTemplates: any[]
  templatesLoaded: boolean
  selectedTemplate: string


  setTemplates: (templates: any[], loaded: boolean, selected: string) => void

  hydrateTemplates: () => Promise<void>



  // All flow editor actions - components should call these instead of RPC
  loadTemplate: (templateId: string) => Promise<{ ok: boolean; error?: string }>
  saveAsProfile: (params: { name: string; library: string; nodes: any[]; edges: any[] }) => Promise<{ ok: boolean; error?: string }>
  deleteProfile: (name: string) => Promise<{ ok: boolean; error?: string }>
  createNewFlowNamed: (name: string) => Promise<{ ok: boolean; error?: string }>
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

    // Cancel any pending auto-saves for the current flow before switching
    useFlowEditorLocal.getState().cancelSave()

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

    // Cancel pending auto-save since we are doing a manual save now
    useFlowEditorLocal.getState().cancelSave()

    try {
      // Sync graph to backend first
      await client.rpc('flowEditor.setGraph', { nodes, edges })
      const res: any = await client.rpc('flowEditor.saveAsProfile', { name, library, nodes, edges })
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

    // Crucial: Cancel any pending auto-saves before deleting.
    // This prevents a debounced save from re-creating the profile file
    // after we've deleted it.
    useFlowEditorLocal.getState().cancelSave()

    const oldTemplates = get().availableTemplates
    const deletedTemplate = oldTemplates.find(t => t.id === name)
    const wasSelected = get().selectedTemplate === name

    try {
      const res: any = await client.rpc('flowEditor.deleteProfile', { name })
      if (res?.ok) {
        // Refresh templates list
        await get().hydrateTemplates()

        // If it was selected, we need to switch to a new one
        if (wasSelected) {
          // Get the FRESH list after hydration to ensure we don't pick the deleted one
          const newTemplates = get().availableTemplates.filter(t => t.id !== name)
          
          if (newTemplates.length > 0) {
            // Find successor in the same library if possible
            const sameLibrary = newTemplates.filter(t => t.library === deletedTemplate?.library)
            let successor = null

            if (sameLibrary.length > 0) {
              // Try to find the one at the same relative position
              const oldInLibrary = oldTemplates.filter(t => t.library === deletedTemplate?.library)
              const oldIdxInLibrary = oldInLibrary.findIndex(t => t.id === name)
              const nextIdx = Math.min(oldIdxInLibrary, sameLibrary.length - 1)
              successor = sameLibrary[nextIdx]
            } else {
              // Fallback to system default or first available
              successor = newTemplates.find(t => t.library === 'system') || newTemplates[0]
            }

            if (successor) {
              console.log(`[flowEditor] Switching to successor after delete: ${successor.id}`)
              // Important: We call the RPC directly or use a version of loadTemplate 
              // that doesn't trigger secondary hydrations if possible, but for now 
              // calling the existing action is safest.
              await get().loadTemplate(successor.id)
            }
          } else {
            // No templates left, clear selection
            set({ selectedTemplate: '' })
          }
        }
      }
      return res
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },

  // Create a new flow with a given name
  createNewFlowNamed: async (name: string) => {
    const client = getBackendClient()
    if (!client) return { ok: false }

    // Cancel any pending auto-saves for the current flow
    useFlowEditorLocal.getState().cancelSave()

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

