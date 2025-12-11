import { create } from 'zustand'
import type { LspDiagnosticsEvent } from '../../shared/lsp'
import { LSP_NOTIFICATION_DIAGNOSTICS } from '../../shared/lsp'
import { getBackendClient } from '@/lib/backend/bootstrap'
import { handleDiagnostics as applyToMonaco, clearDiagnosticsForWorkspace } from '@/lib/lsp/diagnostics'
import { useExplorerStore } from './explorer'

interface LspDiagnosticsState {
  diagnosticsByUri: Record<string, LspDiagnosticsEvent>
  lastUpdatedAt: number | null
  applyDiagnostics: (payload: LspDiagnosticsEvent) => void
  resetWorkspace: (workspaceRoot?: string | null) => void
}

export const useLspDiagnosticsStore = create<LspDiagnosticsState>((set) => ({
  diagnosticsByUri: {},
  lastUpdatedAt: null,
  applyDiagnostics: (payload) => {
    if (!payload?.uri) return
    applyToMonaco(payload)
    set((state) => ({
      diagnosticsByUri: { ...state.diagnosticsByUri, [payload.uri]: payload },
      lastUpdatedAt: Date.now(),
    }))
    try {
      useExplorerStore.getState().applyDiagnosticsFromLsp(payload)
    } catch (error) {
      console.warn('[explorer] Failed to mirror diagnostics', error)
    }
  },
  resetWorkspace: (workspaceRoot) => {
    clearDiagnosticsForWorkspace(workspaceRoot ?? null)
    if (!workspaceRoot) {
      set({ diagnosticsByUri: {}, lastUpdatedAt: null })
      return
    }
    set((state) => {
      const next = { ...state.diagnosticsByUri }
      for (const [uri, payload] of Object.entries(next)) {
        if (payload.workspaceRoot === workspaceRoot) {
          delete next[uri]
        }
      }
      return { diagnosticsByUri: next, lastUpdatedAt: state.lastUpdatedAt }
    })
  },
}))

let eventsBound = false
export function initLspEvents(): void {
  if (eventsBound) return
  const client = getBackendClient()
  if (!client) return
  eventsBound = true

  client.subscribe(LSP_NOTIFICATION_DIAGNOSTICS, (payload: LspDiagnosticsEvent) => {
    try {
      useLspDiagnosticsStore.getState().applyDiagnostics(payload)
    } catch (error) {
      console.warn('[lsp] Failed to apply diagnostics', error)
    }
  })

  client.subscribe('workspace.attached', (payload: any) => {
    const root = payload?.root || payload?.workspaceRoot || null
    try {
      useLspDiagnosticsStore.getState().resetWorkspace(root)
    } catch (error) {
      console.warn('[lsp] Failed to reset diagnostics', error)
    }
  })
}
