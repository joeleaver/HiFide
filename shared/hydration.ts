/**
 * Unified Hydration State Machine
 * 
 * This module defines the state machine for application-wide hydration.
 * Used by both main process and renderer to ensure consistent state tracking.
 * 
 * Architecture:
 * - Each window has its own hydration state (multi-window support)
 * - Main process tracks per-connection hydration phase
 * - Renderer receives complete snapshots, not piecemeal updates
 * - Single source of truth eliminates race conditions
 */

/**
 * Hydration phases - a linear progression from disconnected to ready.
 * Only forward transitions are allowed (except for error recovery).
 */
export type HydrationPhase =
  | 'disconnected'      // No WebSocket connection
  | 'connecting'        // WebSocket handshake in progress
  | 'connected'         // Connected but no workspace bound
  | 'binding'           // Workspace binding in progress
  | 'loading'           // Workspace bound, loading initial data
  | 'ready'             // Fully hydrated and ready for user interaction
  | 'error'             // Error state (can transition back to connecting)

/**
 * Human-readable messages for each phase (used by loading overlay)
 */
export const PHASE_MESSAGES: Record<HydrationPhase, string | null> = {
  disconnected: 'Connecting to backend...',
  connecting: 'Connecting to backend...',
  connected: 'Waiting for workspace...',
  binding: 'Opening workspace...',
  loading: 'Restoring session...',
  ready: null,
  error: 'Something went wrong',
}

/**
 * Whether the loading overlay should be shown for a given phase
 */
export function isLoadingPhase(phase: HydrationPhase): boolean {
  return phase !== 'ready' && phase !== 'disconnected'
}

/**
 * Valid phase transitions
 */
export const VALID_TRANSITIONS: Record<HydrationPhase, HydrationPhase[]> = {
  disconnected: ['connecting'],
  connecting: ['connected', 'ready', 'error', 'disconnected'], // Allow direct to ready for fast path
  connected: ['binding', 'loading', 'ready', 'disconnected'], // Allow loading/ready if workspace already attached
  binding: ['loading', 'error', 'disconnected'],
  loading: ['ready', 'error', 'disconnected'],
  ready: ['loading', 'binding', 'disconnected'], // Can go back to loading on session switch
  error: ['connecting', 'disconnected'],
}

/**
 * Check if a phase transition is valid
 */
export function isValidTransition(from: HydrationPhase, to: HydrationPhase): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Workspace snapshot - complete state sent to renderer on connect/bind
 * This is the single source of truth for initial hydration.
 */
export interface WorkspaceSnapshot {
  // Workspace identity
  workspaceId: string
  workspaceRoot: string
  
  // Sessions
  sessions: Array<{ id: string; title: string }>
  currentSessionId: string | null
  
  // Current session's timeline (if a session is selected)
  timeline: Array<any> // TimelineItem[]
  
  // Session metadata
  meta: {
    executedFlowId: string
    providerId: string
    modelId: string
  }
  
  // Usage stats
  usage: {
    tokenUsage?: any
    costs?: any
    requestsLog?: any[]
  }
  
  // Flow editor
  flowEditor: {
    templates: Array<{ id: string; name: string; library?: string }>
    selectedTemplate: string
    nodes: any[]
    edges: any[]
  }

  // Flow contexts
  flowContexts: {
    mainContext: any | null
    isolatedContexts: Record<string, any>
  }

  // Kanban
  kanban: {
    board: any | null
  }

  // Provider/model settings
  settings: {
    providerValid: Record<string, boolean>
    modelsByProvider: Record<string, Array<{ value: string; label: string }>>
  }

  // Knowledge base (full data)
  knowledgeBase: {
    items: Record<string, any>
    files: string[]
  }
  
  // Timestamp for freshness checking
  snapshotTime: number
}

/**
 * Delta update - partial state update sent after initial snapshot
 */
export interface WorkspaceDelta {
  type: 'sessions' | 'timeline' | 'meta' | 'usage' | 'flowEditor' | 'kanban' | 'settings' | 'knowledgeBase'
  payload: any
  version: number // Monotonic version for ordering
}

/**
 * Hydration timeout configuration
 */
export const HYDRATION_TIMEOUTS = {
  /** Max time to wait for connection */
  CONNECT_MS: 5000,
  /** Max time to wait for workspace binding */
  BIND_MS: 5000,
  /** Max time to wait for initial snapshot */
  SNAPSHOT_MS: 10000,
  /** Max time from start to ready (safety timeout) */
  TOTAL_MS: 15000,
} as const

// =============================================================================
// SCREEN-LEVEL HYDRATION (per-feature lifecycle)
// =============================================================================

/**
 * Screen hydration phases for individual features.
 * Simpler than app-level phases since screens don't deal with connection state.
 *
 * - idle: Screen not visible/active, no data loaded
 * - loading: Fetching initial data for this screen
 * - ready: Data loaded, screen is interactive
 * - refreshing: Updating data while showing existing content (optimistic UI)
 * - error: Failed to load data
 */
export type ScreenPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'error'

/**
 * Screen identifiers for all major screens in the app
 */
export type ScreenId =
  | 'flowEditor'
  | 'explorer'
  | 'kanban'
  | 'knowledgeBase'
  | 'settings'
  | 'sourceControl'
  | 'terminal'

/**
 * Screen-level hydration state
 */
export interface ScreenHydrationState {
  phase: ScreenPhase
  error?: string
  since: number  // When current phase started
  lastReady?: number  // When last successfully reached 'ready'
}

/**
 * Messages to display for each screen phase
 */
export const SCREEN_PHASE_MESSAGES: Record<ScreenPhase, string | null> = {
  idle: null,
  loading: 'Loading…',
  ready: null,
  refreshing: null,  // Don't show message during refresh (show stale content)
  error: 'Failed to load',
}

/**
 * Check if a screen phase indicates loading state (should show skeleton)
 */
export function isScreenLoading(phase: ScreenPhase): boolean {
  return phase === 'loading'
}

/**
 * Check if a screen has data to display (ready or refreshing)
 */
export function hasScreenData(phase: ScreenPhase): boolean {
  return phase === 'ready' || phase === 'refreshing'
}

/**
 * Screen hydration timeouts (ms)
 */
export const SCREEN_TIMEOUTS = {
  /** Max time a screen can stay in loading before auto-error */
  maxLoading: 30_000,
  /** Debounce for refresh requests */
  refreshDebounce: 500,
} as const

/**
 * Valid screen phase transitions
 */
export const SCREEN_TRANSITIONS: Record<ScreenPhase, ScreenPhase[]> = {
  idle: ['loading'],
  loading: ['ready', 'error', 'idle'],
  ready: ['refreshing', 'loading', 'idle'],  // loading = full reload, refreshing = background update
  refreshing: ['ready', 'error'],
  error: ['loading', 'idle'],
}

/**
 * Check if a screen phase transition is valid
 */
export function isValidScreenTransition(from: ScreenPhase, to: ScreenPhase): boolean {
  return SCREEN_TRANSITIONS[from]?.includes(to) ?? false
}
