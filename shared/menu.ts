import type { ViewType } from '../electron/store/types'

export interface RendererMenuFileActionsState {
  visible: boolean
  canCreateFile: boolean
  canOpenFile: boolean
  canSave: boolean
  canSaveAs: boolean
}

export interface RendererMenuStatePayload {
  view: ViewType
  workspaceAttached: boolean
  hasOpenTab: boolean
  hasDirtyTab: boolean
  fileActions: RendererMenuFileActionsState
  windowId?: number | null
}

export const DEFAULT_RENDERER_MENU_STATE: RendererMenuStatePayload = {
  view: 'flow',
  workspaceAttached: false,
  hasOpenTab: false,
  hasDirtyTab: false,
  fileActions: {
    visible: false,
    canCreateFile: false,
    canOpenFile: false,
    canSave: false,
    canSaveAs: false,
  },
  windowId: null,
}
