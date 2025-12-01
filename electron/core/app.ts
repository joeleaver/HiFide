/**
 * Application lifecycle management
 * 
 * Handles app initialization, lifecycle events, and shutdown
 */

import { app, BrowserWindow } from 'electron'
import { createWindow } from './window'

/**
 * Initialize the application
 *
 * Sets up app lifecycle handlers and creates the main window
 */
export function initializeApp(onReady?: () => void): void {
  /**
   * App ready handler
   */
  app.whenReady().then(() => {
    // Create main window
    createWindow()

    // Call optional ready callback (for menu building, etc.)
    onReady?.()
  })

  /**
   * Window all closed handler
   */
  app.on('window-all-closed', () => {
    // On macOS, apps typically stay active until explicitly quit
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  /**
   * Activate handler (macOS)
   */
  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

