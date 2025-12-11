import type { StateCreator } from 'zustand'

import { loadExplorerState, saveExplorerState } from '../utils/explorerPersistence'
import {
  DEFAULT_OPEN_FILES_PANE_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_OPEN_FILES_PANE_HEIGHT,
  MAX_SIDEBAR_WIDTH,
  MIN_OPEN_FILES_PANE_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  type SidebarMode,
} from './constants'
import type { ExplorerSidebarSlice, ExplorerStore } from './types'

export const createExplorerSidebarSlice: StateCreator<ExplorerStore, [], [], ExplorerSidebarSlice> = (set) => {
  const persisted = loadExplorerState()
  const sidebarWidth = clampSidebarWidth(persisted.sidebarWidth)
  const openFilesPaneHeight = clampOpenFilesPaneHeight(persisted.openFilesPaneHeight)
  const sidebarMode = normalizeSidebarMode(persisted.sidebarMode)

  return {
    sidebarWidth,
    openFilesPaneHeight,
    sidebarMode,
    setSidebarWidth: (width) => {
      const nextWidth = clampSidebarWidth(width)
      set({ sidebarWidth: nextWidth })
      saveExplorerState({ sidebarWidth: nextWidth })
    },
    setOpenFilesPaneHeight: (height) => {
      const nextHeight = clampOpenFilesPaneHeight(height)
      set({ openFilesPaneHeight: nextHeight })
      saveExplorerState({ openFilesPaneHeight: nextHeight })
    },
    setSidebarMode: (mode) => {
      const normalized = normalizeSidebarMode(mode)
      set({ sidebarMode: normalized })
      saveExplorerState({ sidebarMode: normalized })
    },
  }
}

export function clampSidebarWidth(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
}

export function clampOpenFilesPaneHeight(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_OPEN_FILES_PANE_HEIGHT
  return Math.min(MAX_OPEN_FILES_PANE_HEIGHT, Math.max(MIN_OPEN_FILES_PANE_HEIGHT, value))
}

export function normalizeSidebarMode(mode?: SidebarMode | string | null): SidebarMode {
  return mode === 'search' ? 'search' : 'workspace'
}
