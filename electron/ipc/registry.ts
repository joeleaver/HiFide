/**
 * IPC handler registry
 * 
 * Central registration point for all IPC handlers
 * 
 * NOTE: Almost all IPC handlers have been removed and migrated to WebSocket JSON-RPC.
 * Only the menu handler remains for OS integration.
 */

import type { IpcMain } from 'electron'
import { registerMenuHandlers } from './menu'

/**
 * Register all IPC handlers
 *
 * This is the single entry point for registering all IPC handlers.
 * Call this once during app initialization.
 * 
 * Removed handlers (migrated to WebSocket JSON-RPC or deleted as unused):
 * - capabilities (capabilities:get)
 * - sessions (sessions:list/load/save/delete)
 * - filesystem (fs:getCwd/readFile/readDir/watchStart/watchStop)
 * - workspace (workspace:*, settings:*)
 * - indexing (index:rebuild/status/cancel/clear/search)
 * - flowProfiles (flow-profiles:get/set/list/delete/has)
 * - edits (edits:apply/applyRanges/propose)
 * - refactoring (tsrefactor:* - 11 TypeScript refactoring handlers, never used)
 */
export function registerAllHandlers(ipcMain: IpcMain): void {
  // OS integration - the only remaining IPC handler
  registerMenuHandlers(ipcMain)
}
