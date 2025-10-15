/**
 * Provider capabilities IPC handlers
 * 
 * Handles requests for provider capability information
 */

import type { IpcMain } from 'electron'
import { providerCapabilities } from '../core/state'

/**
 * Register capabilities IPC handlers
 */
export function registerCapabilitiesHandlers(ipcMain: IpcMain): void {
  /**
   * Get provider capabilities matrix
   * 
   * Returns which features each provider supports (tools, jsonSchema, vision, streaming)
   */
  ipcMain.handle('capabilities:get', async () => {
    return { ok: true, capabilities: providerCapabilities }
  })
}

