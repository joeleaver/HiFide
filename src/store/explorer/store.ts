import { create } from 'zustand'

import { getBackendClient } from '@/lib/backend/bootstrap'
import { resetWorkspace as resetLspWorkspace } from '@/lib/lsp/client'
import { useEditorStore } from '@/store/editor'
import { useExplorerHydration } from '@/store/screenHydration'
import { GIT_NOTIFICATION_STATUS } from '../../../shared/git'
import type { ExplorerStore } from './types'
import { createExplorerBaseSlice } from './base'
import { createExplorerContextMenuSlice } from './contextMenu'
import { createExplorerSelectionSlice } from './selection'
import { createExplorerSidebarSlice } from './sidebar'

export const useExplorerStore = create<ExplorerStore>()((set, get, api) => ({
  ...createExplorerSidebarSlice(set, get, api),
  ...createExplorerSelectionSlice(set, get, api),
  ...createExplorerContextMenuSlice(set, get, api),
  ...createExplorerBaseSlice(set, get, api),
}))

let explorerEventsBound = false
export function initExplorerEvents(): void {
  if (explorerEventsBound) return
  const client = getBackendClient()
  if (!client) return
  explorerEventsBound = true

  client.subscribe('explorer.fs.event', (payload) => {
    try {
      useExplorerStore.getState().handleFsEvent(payload)
    } catch (error) {
      console.warn('[explorer] Failed to apply fs event', error)
    }
    try {
      useEditorStore.getState().handleFsEvent(payload)
    } catch (error) {
      console.warn('[editor] Failed to process fs event', error)
    }
  })

  client.subscribe(GIT_NOTIFICATION_STATUS, (snapshot) => {
    try {
      useExplorerStore.getState().applyGitStatusSnapshot(snapshot)
    } catch (error) {
      console.warn('[explorer] Failed to apply git snapshot', error)
    }
  })

  client.subscribe('workspace.attached', (payload: any) => {
    const root = (payload?.root || payload?.workspaceRoot || payload?.path || null) as string | null
    try {
      useExplorerStore.getState().resetForWorkspace(root)
      useExplorerStore.getState().reloadPersistedState()
      useExplorerHydration.getState().reset()
      useEditorStore.getState().resetForWorkspace(root)
      void useEditorStore.getState().hydrateFromPersistence()
    } catch (error) {
      console.warn('[explorer] Failed to reset store for workspace', error)
    }
    void useExplorerStore.getState().refreshGitStatus()
    void (async () => {
      try {
        await resetLspWorkspace()
      } catch (error) {
        console.warn('[explorer] Failed to reset LSP workspace', error)
      }
    })()
  })
}
