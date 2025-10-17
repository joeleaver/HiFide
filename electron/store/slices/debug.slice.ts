/**
 * Debug Slice
 * 
 * Manages debug logging for the application.
 * 
 * Responsibilities:
 * - Store debug log entries
 * - Add new log entries
 * - Clear logs
 * - Limit log size to prevent memory issues
 */

import type { StateCreator } from 'zustand'
import type { DebugLogEntry } from '../types'
import { MAX_DEBUG_LOGS } from '../utils/constants'

// ============================================================================
// Types
// ============================================================================

export interface DebugSlice {
  // State
  debugLogs: DebugLogEntry[]
  
  // Actions
  addDebugLog: (level: 'info' | 'warning' | 'error', category: string, message: string, data?: any) => void
  clearDebugLogs: () => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createDebugSlice: StateCreator<DebugSlice> = (set) => ({
  // State
  debugLogs: [],
  
  // Actions
  addDebugLog: (level, category, message, data) => {
    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    }
    
    set((state) => {
      const newLogs = [...state.debugLogs, entry]
      
      // Limit log size to prevent memory issues
      if (newLogs.length > MAX_DEBUG_LOGS) {
        return { debugLogs: newLogs.slice(-MAX_DEBUG_LOGS) }
      }
      
      return { debugLogs: newLogs }
    })
  },
  
  clearDebugLogs: () => {
    set({ debugLogs: [] })
  },
})

