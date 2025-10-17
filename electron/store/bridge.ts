/**
 * Zubridge Setup for Main Process
 * 
 * This sets up the bridge between the main process store and renderer processes.
 * The bridge automatically synchronizes state changes between processes.
 */

import { createZustandBridge } from '@zubridge/electron/main'
import { useMainStore } from './index'

/**
 * Create the zubridge instance
 * This should be called once when the app starts, before creating any windows
 *
 * Note: We pass useMainStore directly - zubridge expects the Zustand hook/store API
 */
const bridge = createZustandBridge(useMainStore)

/**
 * Subscribe a window to the bridge
 * Call this for each BrowserWindow you create
 */
export const registerWindow = (window: Electron.BrowserWindow) => {
  bridge.subscribe([window])
}

/**
 * Unsubscribe a window from the bridge
 * Call this when a window is closed
 */
export const unregisterWindow = (_window: Electron.BrowserWindow) => {
  // Note: zubridge doesn't have an unsubscribe method for individual windows
  // Windows are automatically cleaned up when they're destroyed
}

