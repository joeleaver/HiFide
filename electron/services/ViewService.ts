/**
 * View Service
 * 
 * Manages the current application view state.
 * 
 * Responsibilities:
 * - Track current view (agent, explorer, flowEditor, etc.)
 * - Persist view selection
 * - Provide view switching functionality
 * - Notify renderers of view changes
 */

import { Service } from './base/Service'
import type { ViewType } from '../store/types'
import { setAppView } from './appBridge'

// ============================================================================
// Types
// ============================================================================

interface ViewState {
  currentView: ViewType
}

// ============================================================================
// Service Implementation
// ============================================================================

export class ViewService extends Service<ViewState> {
  constructor() {
    // Load persisted view, default to 'flow'
    super({ currentView: 'flow' }, 'view')
  }

  /**
   * Set the current view
   */
  setView(view: ViewType): void {
    if (this.state.currentView === view) return

    this.setState({ currentView: view })

    // Also notify the main process (for menu updates, etc.)
    try {
      void setAppView(view)
    } catch (e) {
      console.error('[ViewService] Failed to call setAppView:', e)
    }
  }

  /**
   * Get the current view
   */
  getCurrentView(): ViewType {
    return this.state.currentView
  }

  /**
   * Persist view changes and notify renderers
   */
  protected onStateChange(updates: Partial<ViewState>): void {
    if (updates.currentView !== undefined) {
      // Persist the view
      this.persistFields(['currentView'])

      // Emit event for local listeners
      this.emit('view:changed', updates.currentView)

      // Note: WebSocket notification will be added when we update ws/server.ts
    }
  }
}

