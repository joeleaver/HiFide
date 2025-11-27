/**
 * UI Service
 *
 * Manages UI panel states (sidebar, meta panel, terminal panels, etc.)
 *
 * Responsibilities:
 * - Track panel open/closed states
 * - Track panel sizes (heights/widths)
 * - Persist UI preferences via windowState object
 */

import { Service } from './base/Service'

// ============================================================================
// Types
// ============================================================================

/**
 * Window state - all UI panel sizes and states in one object
 * This is persisted as a single unit to avoid duplication
 */
export interface WindowState {
  // Agent Mode
  agentMode: 'chat' | 'flow'

  // Flow Canvas Panel
  flowCanvasCollapsed: boolean
  flowCanvasWidth: number

  // Meta Panel (Tools Panel)
  metaPanelOpen: boolean
  metaPanelWidth: number

  // Sidebar
  sidebarCollapsed: boolean

  // Debug Panel (Flow Debug)
  debugPanelCollapsed: boolean
  debugPanelHeight: number

  // Context Inspector Panel
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number

  // Tokens & Costs Panel
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number

  // Session Panel (in Agent view)
  sessionPanelWidth: number
  sessionPanelHeight: number

  // Agent Terminal Panel
  agentTerminalPanelOpen: boolean
  agentTerminalPanelHeight: number

  // Explorer Terminal Panel
  explorerTerminalPanelOpen: boolean
  explorerTerminalPanelHeight: number
  rightPaneCollapsed: boolean
}

interface UiState {
  windowState: WindowState
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WINDOW_STATE: WindowState = {
  agentMode: 'chat',
  flowCanvasCollapsed: false,
  flowCanvasWidth: 600,
  metaPanelOpen: false,
  metaPanelWidth: 300,
  sidebarCollapsed: false,
  debugPanelCollapsed: false,
  debugPanelHeight: 300,
  contextInspectorCollapsed: false,
  contextInspectorHeight: 200,
  tokensCostsCollapsed: false,
  tokensCostsHeight: 250,
  sessionPanelWidth: 400,
  sessionPanelHeight: 400,
  rightPaneCollapsed: false,
  agentTerminalPanelOpen: false,
  agentTerminalPanelHeight: 300,
  explorerTerminalPanelOpen: false,
  explorerTerminalPanelHeight: 300,
}

// ============================================================================
// Service Implementation
// ============================================================================

export class UiService extends Service<UiState> {
  constructor() {
    // Load persisted window state
    const persisted = new Service<UiState>({ windowState: DEFAULT_WINDOW_STATE }, 'ui')
      .persistence.load<WindowState>('windowState', DEFAULT_WINDOW_STATE)
    
    super({ windowState: persisted }, 'ui')
  }

  /**
   * Update window state (with broadcast to renderers)
   */
  updateWindowState(updates: Partial<WindowState>): void {
    // Shallow compare only the provided keys to avoid unnecessary updates
    const keys = Object.keys(updates) as (keyof WindowState)[]
    let changed = false
    for (const k of keys) {
      if (this.state.windowState[k] !== updates[k]) {
        changed = true
        break
      }
    }

    if (!changed) return

    this.setState({
      windowState: { ...this.state.windowState, ...updates }
    })
  }

  /**
   * Persist window state without broadcasting
   * Used for high-frequency updates (e.g., panel resizing)
   */
  persistWindowState(updates: Partial<WindowState>): void {
    try {
      const current = this.persistence.load<WindowState>('windowState', DEFAULT_WINDOW_STATE)
      const next = { ...current, ...updates }
      this.persistence.save('windowState', next)
      
      // Update in-memory state without triggering onStateChange
      this.state.windowState = next
    } catch (err) {
      console.error('[UiService] persistWindowState failed:', err)
    }
  }

  /**
   * Get window state
   */
  getWindowState(): Readonly<WindowState> {
    return this.state.windowState
  }

  /**
   * Persist and notify on state changes
   */
  protected onStateChange(updates: Partial<UiState>): void {
    if (updates.windowState) {
      // Persist the entire window state
      this.persistence.save('windowState', updates.windowState)

      // Emit event for local listeners
      this.emit('windowState:changed', updates.windowState)

      // Note: WebSocket notification will be added when we update ws/server.ts
    }
  }
}

