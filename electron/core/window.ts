/**
 * Window creation and state management
 *
 * Handles BrowserWindow creation, state persistence, and lifecycle
 */

import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setWindow, windowStateStore } from './state'

import { startWsBackend } from '../backend/ws/server'

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
export function createWindow(opts?: { offsetFromCurrent?: boolean; workspaceId?: string }): BrowserWindow {
  console.time('[window] createWindow')
  // Determine initial window state
  const useOffset = Boolean(opts?.offsetFromCurrent)
  let windowState: WindowState
  if (useOffset) {
    // Fixed default size, offset from the currently focused (or first) window by ~100px
    const base = getDefaultWindowState()
    const anchor = BrowserWindow.getFocusedWindow() || getWindow()
    let x = base.x
    let y = base.y
    try {
      if (anchor) {
        const ab = anchor.getBounds()
        x = ab.x + 100
        y = ab.y + 100
      }
    } catch {}
    windowState = validateWindowState({ ...base, x, y, isMaximized: false })
  } else {
    // First/main window restores saved state (position/size or sensible centered default)
    windowState = loadWindowState()
  }

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
  win.on('close', async () => {
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout)
    }
    saveWindowState()

    // Unbind window from workspace
    try {
      const { getWorkspaceManager } = await import('./workspaceManager.js')
      const manager = getWorkspaceManager()
      await manager.unbindWindow(win)
    } catch (error) {
      console.error('[window] Failed to unbind workspace:', error)
    }
  })

  // Test active push message to Renderer-process
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date()).toLocaleString())
  })

  // Crash diagnostics for renderer process
  try {
    win.webContents.on('render-process-gone', (_event, details: any) => {
      console.error('[renderer gone]', { reason: details?.reason, exitCode: details?.exitCode })
    })
    win.on('unresponsive', () => {
      console.error('[window] unresponsive')
    })
    win.on('responsive', () => {
      console.log('[window] responsive')
    })
  } catch {}


  // Bind window to workspace if provided
  if (opts?.workspaceId) {
    const workspaceId = opts.workspaceId
    ;(async () => {
      try {
        const { getWorkspaceManager } = await import('./workspaceManager.js')
        const manager = getWorkspaceManager()
        await manager.bindWindowToWorkspace(win, workspaceId)

        // Update store
        const { ServiceRegistry } = await import('../services/base/ServiceRegistry.js')
        const workspaceService = ServiceRegistry.get<any>('workspace')
        workspaceService?.setWorkspaceForWindow({ windowId: win.id, workspaceId })
      } catch (error) {
        console.error('[window] Failed to bind workspace:', error)
      }
    })()
  }

  // Start WS backend and wait for bootstrap, then load the renderer with query params
  ;(async () => {
    try {
      const boot = await startWsBackend()
      const wsUrl = boot.url
      const wsToken = boot.token

      // Load URL with query parameters for preload to consume
      if (VITE_DEV_SERVER_URL) {
        console.time('[window] loadURL(dev)')
        try {
          const devUrl = new URL(VITE_DEV_SERVER_URL)
          devUrl.searchParams.set('wsUrl', wsUrl)
          devUrl.searchParams.set('wsToken', wsToken)
          devUrl.searchParams.set('windowId', String(win.id))
          await win.loadURL(devUrl.toString())
        } catch {
          // Fallback if VITE_DEV_SERVER_URL is not a full URL
          await win.loadURL(`${VITE_DEV_SERVER_URL}?wsUrl=${encodeURIComponent(wsUrl)}&wsToken=${encodeURIComponent(wsToken)}&windowId=${win.id}`)
        }
        console.timeEnd('[window] loadURL(dev)')
        win.webContents.openDevTools({ mode: 'detach' })
      } else {
        console.time('[window] loadFile(prod)')
        await win.loadFile(path.join(DIRNAME, '../dist/index.html'), {
          query: { wsUrl, wsToken, windowId: String(win.id) }
        } as any)
        console.timeEnd('[window] loadFile(prod)')
        // DevTools disabled in production
      }
    } catch (e) {
      console.error('[window] failed to start WS backend', e)
      // Fallback: load without ws params
      if (VITE_DEV_SERVER_URL) {
        await win.loadURL(VITE_DEV_SERVER_URL)
      } else {
        await win.loadFile(path.join(DIRNAME, '../dist/index.html'))
      }
    }
  })()

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



  // Re-assert global error capture at end of setup.
  // Some libraries set their own uncaughtException capture callbacks; we want
  // to ignore benign PTY teardown errors so the app doesn't crash on restart.
  try {
    const setCapture = (process as any).setUncaughtExceptionCaptureCallback as
      | ((cb: ((err: any) => void) | null) => void)
      | undefined

    const isIgnorable = (err: any) => {
      if (!err) return false
      const code = (err as any).code as string | undefined
      const syscall = (err as any).syscall as string | undefined
      const msg = String((err as any).message || err)
      if (code === 'EPIPE' && (syscall === 'read' || syscall === 'write')) return true
      if (code === 'ECONNRESET' && /socket|pipe|stream/i.test(msg)) return true
      return false
    }

    if (typeof setCapture === 'function') {
      const capture = (err: any) => {
        if (isIgnorable(err)) {
          console.warn('[window] Ignored uncaught exception', { code: err?.code, syscall: err?.syscall })
          return
        }
        // Let other listeners see non-ignorable errors
        setCapture(null)
        process.emit('uncaughtException', err as any)
        setCapture(capture)
      }
      setCapture(capture)
    } else {
      process.prependListener('uncaughtException', (err: any) => {
        if (isIgnorable(err)) {
          console.warn('[window] Ignored uncaught exception', { code: err?.code, syscall: err?.syscall })
        }
      })
    }
  } catch {}


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

