/**
 * IPC handler registry
 * 
 * Central registration point for all IPC handlers
 */

import type { IpcMain } from 'electron'
import { registerCapabilitiesHandlers } from './capabilities'
import { registerSessionsHandlers } from './sessions'
import { registerFilesystemHandlers } from './filesystem'
import { registerWorkspaceHandlers } from './workspace'
import { registerIndexingHandlers } from './indexing'
import { registerEditsHandlers } from './edits'
import { registerRefactoringHandlers } from './refactoring'
import { registerMenuHandlers } from './menu'
import { registerPtyHandlers } from './pty'

import { registerFlowHandlersV2 } from './flows-v2'
import { registerFlowProfilesHandlers } from './flowProfiles'
// Note: flowState handlers removed - state is now accessible via zubridge
// Note: secrets handlers removed - API keys are now managed via Zustand store (settingsApiKeys)

/**
 * Register all IPC handlers
 *
 * This is the single entry point for registering all IPC handlers.
 * Call this once during app initialization.
 */
export function registerAllHandlers(ipcMain: IpcMain): void {
  // Simple modules
  registerCapabilitiesHandlers(ipcMain)
  registerSessionsHandlers(ipcMain)

  // Medium complexity modules
  registerFilesystemHandlers(ipcMain)
  registerWorkspaceHandlers(ipcMain)
  registerIndexingHandlers(ipcMain)
  registerEditsHandlers(ipcMain)
  registerRefactoringHandlers(ipcMain)
  registerMenuHandlers(ipcMain)

  // Complex modules
  registerPtyHandlers(ipcMain)

  registerFlowHandlersV2(ipcMain) // V2: Clean function-based execution
  registerFlowProfilesHandlers(ipcMain)
  // Note: flowState handlers removed - state is now accessible via zubridge

}

