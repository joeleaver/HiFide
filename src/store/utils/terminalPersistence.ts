import { useBackendBinding } from '../binding'

export interface TerminalPersistedDimensions {
  cols: number
  rows: number
}

export interface TerminalPersistedTab {
  id: string
  title: string
  cwd?: string
  shell?: string
  lastCommand?: string
  lastDimensions?: TerminalPersistedDimensions
  createdAt: number
  updatedAt: number
}

export interface TerminalPersistedPanelState {
  tabs: TerminalPersistedTab[]
  activeId: string | null
  counter: number
}

export interface TerminalPersistedState {
  explorer: TerminalPersistedPanelState
  agent: TerminalPersistedPanelState
}

const STORAGE_PREFIX = 'hifide:terminal:tabs:'
const GLOBAL_KEY = `${STORAGE_PREFIX}global`

function getWorkspaceKey(): string {
  const { workspaceId } = useBackendBinding.getState()
  if (!workspaceId) return GLOBAL_KEY

  try {
    const encoded = typeof btoa === 'function'
      ? btoa(workspaceId)
      : typeof Buffer !== 'undefined'
        ? Buffer.from(workspaceId, 'utf-8').toString('base64')
        : workspaceId
    return `${STORAGE_PREFIX}${encoded.replace(/[^a-zA-Z0-9]/g, '')}`
  } catch {
    let hash = 0
    for (let i = 0; i < workspaceId.length; i += 1) {
      hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i)
      hash |= 0
    }
    return `${STORAGE_PREFIX}${Math.abs(hash).toString(36)}`
  }
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function sanitizeDimensions(value: unknown): TerminalPersistedDimensions | undefined {
  if (!value || typeof value !== 'object') return undefined
  const cols = Number((value as any).cols)
  const rows = Number((value as any).rows)
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return undefined
  if (cols <= 0 || rows <= 0) return undefined
  return { cols: Math.round(cols), rows: Math.round(rows) }
}

function sanitizeTab(raw: unknown): TerminalPersistedTab | null {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof (raw as any).id === 'string' ? (raw as any).id : null
  const title = typeof (raw as any).title === 'string' ? (raw as any).title : null
  if (!id || !title) return null

  const createdAt = Number((raw as any).createdAt)
  const updatedAt = Number((raw as any).updatedAt)

  return {
    id,
    title,
    cwd: sanitizeString((raw as any).cwd),
    shell: sanitizeString((raw as any).shell),
    lastCommand: sanitizeString((raw as any).lastCommand),
    lastDimensions: sanitizeDimensions((raw as any).lastDimensions),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

function sanitizePanel(raw: unknown): TerminalPersistedPanelState {
  const tabs: TerminalPersistedTab[] = []
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).tabs)) {
    for (const entry of (raw as any).tabs) {
      const tab = sanitizeTab(entry)
      if (tab) tabs.push(tab)
    }
  }
  const activeId = typeof (raw as any)?.activeId === 'string' ? (raw as any).activeId : null
  const counterRaw = Number((raw as any)?.counter)
  const counter = Number.isFinite(counterRaw) && counterRaw > 0 ? Math.max(counterRaw, tabs.length) : tabs.length
  return { tabs, activeId: activeId && tabs.some((t) => t.id === activeId) ? activeId : (tabs[0]?.id ?? null), counter }
}

const EMPTY_PANEL: TerminalPersistedPanelState = { tabs: [], activeId: null, counter: 0 }

function getDefaultState(): TerminalPersistedState {
  return {
    explorer: { ...EMPTY_PANEL },
    agent: { ...EMPTY_PANEL },
  }
}

export function loadTerminalState(): TerminalPersistedState {
  if (typeof localStorage === 'undefined') {
    return getDefaultState()
  }

  try {
    const raw = localStorage.getItem(getWorkspaceKey())
    if (!raw) return getDefaultState()
    const parsed = JSON.parse(raw)
    return {
      explorer: sanitizePanel(parsed?.explorer),
      agent: sanitizePanel(parsed?.agent),
    }
  } catch (error) {
    console.warn('[terminalPersistence] Failed to load state', error)
    return getDefaultState()
  }
}

export function saveTerminalState(state: TerminalPersistedState): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: TerminalPersistedState = {
      explorer: sanitizePanel(state?.explorer),
      agent: sanitizePanel(state?.agent),
    }
    localStorage.setItem(getWorkspaceKey(), JSON.stringify(payload))
  } catch (error) {
    console.warn('[terminalPersistence] Failed to save state', error)
  }
}

export function clearTerminalState(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(getWorkspaceKey())
  } catch (error) {
    console.warn('[terminalPersistence] Failed to clear state', error)
  }
}
