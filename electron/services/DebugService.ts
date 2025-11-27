/**
 * Debug Service
 * 
 * Manages debug logging for the application.
 * 
 * Responsibilities:
 * - Store debug log entries
 * - Add new log entries
 * - Clear logs
 * - Limit log size to prevent memory issues
 */

import { Service } from './base/Service'
import type { DebugLogEntry } from '../store/types'
import { MAX_DEBUG_LOGS } from '../store/utils/constants'

// ============================================================================
// Types
// ============================================================================

interface DebugState {
  logs: DebugLogEntry[]
}

// ============================================================================
// Service Implementation
// ============================================================================

export class DebugService extends Service<DebugState> {
  constructor() {
    // No persistence needed for debug logs
    super({ logs: [] })
  }

  /**
   * Add a debug log entry
   */
  addLog(level: 'info' | 'warning' | 'error', category: string, message: string, data?: any): void {
    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    }

    const newLogs = [...this.state.logs, entry]

    // Limit log size to prevent memory issues
    if (newLogs.length > MAX_DEBUG_LOGS) {
      this.setState({ logs: newLogs.slice(-MAX_DEBUG_LOGS) })
    } else {
      this.setState({ logs: newLogs })
    }
  }

  /**
   * Clear all debug logs
   */
  clearLogs(): void {
    this.setState({ logs: [] })
  }

  /**
   * Get all debug logs
   */
  getLogs(): readonly DebugLogEntry[] {
    return this.state.logs
  }

  /**
   * No persistence or notifications needed for debug logs
   */
  protected onStateChange(): void {
    // Debug logs are transient - no persistence or notifications
  }
}

