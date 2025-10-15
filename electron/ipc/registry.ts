/**
 * IPC handler registry
 * 
 * Central registration point for all IPC handlers
 */

import type { IpcMain } from 'electron'
import { registerCapabilitiesHandlers } from './capabilities'
import { registerSecretsHandlers } from './secrets'
import { registerSessionsHandlers } from './sessions'
import { registerPlanningHandlers } from './planning'
import { registerFilesystemHandlers } from './filesystem'
import { registerWorkspaceHandlers } from './workspace'
import { registerIndexingHandlers } from './indexing'
import { registerEditsHandlers } from './edits'
import { registerRefactoringHandlers } from './refactoring'
import { registerMenuHandlers } from './menu'
import { registerPtyHandlers } from './pty'
import { registerLlmCoreHandlers } from './llm-core'
import { registerFlowHandlersV2 } from './flows-v2'
import { registerFlowProfilesHandlers } from './flowProfiles'

/**
 * Register all IPC handlers
 * 
 * This is the single entry point for registering all IPC handlers.
 * Call this once during app initialization.
 */
export function registerAllHandlers(ipcMain: IpcMain): void {
  // Simple modules
  registerCapabilitiesHandlers(ipcMain)
  registerSecretsHandlers(ipcMain)
  registerSessionsHandlers(ipcMain)
  registerPlanningHandlers(ipcMain)

  // Medium complexity modules
  registerFilesystemHandlers(ipcMain)
  registerWorkspaceHandlers(ipcMain)
  registerIndexingHandlers(ipcMain)
  registerEditsHandlers(ipcMain)
  registerRefactoringHandlers(ipcMain)
  registerMenuHandlers(ipcMain)

  // Complex modules
  registerPtyHandlers(ipcMain)
  registerLlmCoreHandlers(ipcMain)
  registerFlowHandlersV2(ipcMain) // V2: Clean function-based execution
  registerFlowProfilesHandlers(ipcMain)

  console.log('[registry] All IPC handlers registered (using Flow Engine V2)')
}

