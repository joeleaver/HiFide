export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 520
export const DEFAULT_SIDEBAR_WIDTH = 260

export const MIN_OPEN_FILES_PANE_HEIGHT = 72
export const MAX_OPEN_FILES_PANE_HEIGHT = 360
export const DEFAULT_OPEN_FILES_PANE_HEIGHT = 136

export const SIDEBAR_MODES = ['workspace', 'search'] as const
export type SidebarMode = (typeof SIDEBAR_MODES)[number]

export const CLIPBOARD_TTL_MS = 60_000
