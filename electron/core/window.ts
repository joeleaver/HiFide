/**
 * Window creation and state management
 * 
 * Handles BrowserWindow creation, state persistence, and lifecycle
 */

import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setWindow, windowStateStore } from './state'
import { registerWindow, unregisterWindow } from '../store/bridge'

// Environment variables from Vite
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const VITE_PUBLIC = process.env['VITE_PUBLIC']
// Works in both CJS and ESM builds
const DIRNAME = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

/**
 * Window state interface
 */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

/**
 * Get default window state (centered, 1200x800 or 80% of screen)
 */
function getDefaultWindowState(): WindowState {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // Default to 1200x800, or 80% of screen size if smaller
  const defaultWidth = Math.min(1200, Math.floor(screenWidth * 0.8))
  const defaultHeight = Math.min(800, Math.floor(screenHeight * 0.8))

  // Center the window
  const x = Math.floor((screenWidth - defaultWidth) / 2)
  const y = Math.floor((screenHeight - defaultHeight) / 2)

  return {
    width: defaultWidth,
    height: defaultHeight,
    x,
    y,
    isMaximized: false,
  }
}

/**
 * Validate window state to ensure it's visible on screen
 */
function validateWindowState(state: WindowState): WindowState {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // Minimum window size
  const minWidth = 800
  const minHeight = 600

  // Validate dimensions
  let width = Math.max(minWidth, Math.min(state.width, screenWidth))
  let height = Math.max(minHeight, Math.min(state.height, screenHeight))

  // Validate position - ensure window is visible on screen
  let x = state.x
  let y = state.y

  if (x !== undefined && y !== undefined) {
    // Check if window is on any available display
    const displays = screen.getAllDisplays()
    let isVisible = false

    for (const display of displays) {
      const { x: dx, y: dy, width: dw, height: dh } = display.bounds
      // Check if at least part of the window title bar would be visible
      if (
        x + width > dx &&
        x < dx + dw &&
        y + 50 > dy && // At least 50px of title bar visible
        y < dy + dh
      ) {
        isVisible = true
        break
      }
    }

    // If not visible on any display, reset to centered on primary display
    if (!isVisible) {
      x = Math.floor((screenWidth - width) / 2)
      y = Math.floor((screenHeight - height) / 2)
    }
  } else {
    // No position saved, center on primary display
    x = Math.floor((screenWidth - width) / 2)
    y = Math.floor((screenHeight - height) / 2)
  }

  return {
    width,
    height,
    x,
    y,
    isMaximized: state.isMaximized || false,
  }
}

/**
 * Load window state from persistent storage
 */
function loadWindowState(): WindowState {
  try {
    const saved = windowStateStore.get('windowState') as WindowState | undefined
    if (saved) {
      return validateWindowState(saved)
    }
  } catch (e) {
    console.error('[main] Failed to load window state:', e)
  }

  const defaultState = getDefaultWindowState()
  return defaultState
}

/**
 * Save window state to persistent storage
 */
export function saveWindowState(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return

  try {
    // Don't save size if maximized, only save the maximized state
    const isMaximized = win.isMaximized()

    if (isMaximized) {
      // Only update the maximized flag, keep previous size
      const current = windowStateStore.get('windowState') as WindowState | undefined
      windowStateStore.set('windowState', {
        ...current,
        isMaximized: true,
      })
    } else {
      const bounds = win.getBounds()
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: false,
      }
      windowStateStore.set('windowState', state)
    }
  } catch (e) {
    console.error('[main] Failed to save window state:', e)
  }
}

/**
 * Debounced window state saving
 */
let saveWindowStateTimeout: NodeJS.Timeout | null = null
function debouncedSaveWindowState(): void {
  if (saveWindowStateTimeout) {
    clearTimeout(saveWindowStateTimeout)
  }
  saveWindowStateTimeout = setTimeout(() => {
    saveWindowState()
    saveWindowStateTimeout = null
  }, 500)
}

/**
 * Create the main application window
 */
export function createWindow(): BrowserWindow {
  console.time('[window] createWindow')
  // Load saved window state
  const windowState = loadWindowState()

  const win = new BrowserWindow({
    icon: path.join(VITE_PUBLIC || '', 'hifide-logo.png'),
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#1e1e1e',
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      preload: path.join(DIRNAME, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged,
    },
  })

  // Restore maximized state if needed
  if (windowState.isMaximized) {
    win.maximize()
  }

  // Set up window state tracking
  win.on('resize', debouncedSaveWindowState)
  win.on('move', debouncedSaveWindowState)
  win.on('maximize', saveWindowState)
  win.on('unmaximize', saveWindowState)

  // Save state before closing
  win.on('close', () => {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout)
    }
    saveWindowState()
    // Unregister from store bridge
    unregisterWindow(win)
  })

  // Test active push message to Renderer-process
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date()).toLocaleString())
  })

  // Load URL
  if (VITE_DEV_SERVER_URL) {
    console.time('[window] loadURL(dev)')
    win.loadURL(VITE_DEV_SERVER_URL)
    console.timeEnd('[window] loadURL(dev)')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    console.time('[window] loadFile(prod)')
    win.loadFile(path.join(DIRNAME, '../dist/index.html'))
    console.timeEnd('[window] loadFile(prod)')
    // DevTools disabled in production
  }

  // Add F12 shortcut to toggle dev tools (dev only)
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        win.webContents.toggleDevTools()
      }
    })
  }

  // Update global state
  setWindow(win)

  // Register window with store bridge
  console.time('[window] registerWindow')
  registerWindow(win)
  console.timeEnd('[window] registerWindow')

  console.timeEnd('[window] createWindow')
  return win
}

/**
 * Get the main window
 */
export function getWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

