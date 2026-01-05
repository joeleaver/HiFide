/**
 * HiFide Main Process Entry Point
 *
 * This is the main entry point for the Electron main process.
 * Most functionality has been extracted into focused modules in electron/ipc/ and electron/core/.
 *
 * What remains in this file:
 * - Environment setup
 * - Provider initialization
 * - Agent tools registry (TODO: Extract to separate module in future iteration)
 * - Application initialization
 */

import './logger'
import { app, ipcMain } from 'electron'
import path from 'node:path'

// Disable GPU acceleration to prevent SharedImageManager/Skia mailbox errors and hardware-related crashes
app.disableHardwareAcceleration()
import { fileURLToPath } from 'node:url'

// Core modules
import { initializeApp } from './core/app'
import { registerAllHandlers } from './ipc/registry'
import { buildMenu } from './ipc/menu'

// Provider setup

import { AnthropicOpenAIProvider as AnthropicAiSdkProvider } from './providers-ai-sdk/anthropic-openai'
import { GeminiOpenAIProvider as GeminiAiSdkProvider } from './providers-ai-sdk/gemini-openai'

// State management
import { providers, providerCapabilities } from './core/state'
import { initializeServices, getAppService } from './services'

// Agent dependencies
import { initAgentSessionsCleanup } from './session/agentSessions'
import { initializeAgentToolRegistry } from './tools/agentToolRegistry'

// Environment setup
const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(DIRNAME, '..')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST


// ----------------------------------------------------------------------------
// Global error hardening
// Swallow benign OS pipe errors (e.g., EPIPE from PTY/streams) so they don't
// bubble as uncaught exceptions that could crash the process.
// ----------------------------------------------------------------------------
;(() => {
  const isIgnorable = (err: any) => {
    if (!err) return false
    const code = (err as any).code as string | undefined
    const syscall = (err as any).syscall as string | undefined
    const msg = String((err as any).message || err)
    // Common benign cases during PTY/child stream teardown
    if (code === 'EPIPE' && (syscall === 'read' || syscall === 'write')) return true
    if (code === 'ECONNRESET' && /socket|pipe|stream/i.test(msg)) return true
    return false
  }

  // Prefer capture callback so other listeners don’t see ignorable errors
  const setCapture = (process as any).setUncaughtExceptionCaptureCallback as
    | ((cb: ((err: any) => void) | null) => void)
    | undefined

  if (typeof setCapture === 'function') {
    const capture = (err: any) => {
      if (isIgnorable(err)) {
        console.warn('[main] Ignored uncaught exception', { code: (err as any).code, syscall: (err as any).syscall })
        return
      }
      // Forward all other errors to existing listeners exactly once
      setCapture(null)
      process.emit('uncaughtException', err as any)
      setCapture(capture)
    }
    setCapture(capture)
  } else {
    // Fallback: handle first and continue propagation
    process.prependListener('uncaughtException', (err: any) => {
      if (isIgnorable(err)) {
        console.warn('[main] Ignored uncaught exception', { code: err?.code, syscall: err?.syscall })
      }
    })
  }
})()

// ----------------------------------------------------------------------------
// Additional crash diagnostics (main process)
// ----------------------------------------------------------------------------
try {
  app.on('child-process-gone', (_event, details: any) => {
    try {
      console.error('[child-process-gone]', { type: details?.type, reason: details?.reason, exitCode: details?.exitCode })
    } catch (e) {
      console.error('[child-process-gone] error logging details', String(e))
    }
  })
} catch {}

process.on('unhandledRejection', (reason: any) => {
  try {
    const raw = reason as any
    const text = raw?.stack || raw?.message || String(reason)
    // Ignore benign cancellations (expected when stopping a running flow)
    const isCancellation =
      (raw && raw.name === 'AbortError') || /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(text)
    if (isCancellation) {
      console.warn('[main] Ignored unhandledRejection (cancellation)')
      return
    }
    console.error('[main] unhandledRejection', text)
  } catch {
    console.error('[main] unhandledRejection', String(reason))
  }
})


// Initialize provider adapters

providers.anthropic = AnthropicAiSdkProvider as any
providers.gemini = GeminiAiSdkProvider as any

// Initialize provider capabilities
providerCapabilities.openai = { tools: true, jsonSchema: true, vision: false, streaming: true }
providerCapabilities.anthropic = { tools: true, jsonSchema: false, vision: false, streaming: true }
providerCapabilities.gemini = { tools: true, jsonSchema: true, vision: true, streaming: true }


// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize services
  console.time('[main] initializeServices')
  initializeServices()
  console.timeEnd('[main] initializeServices')

  // Build initial agent tool registry (includes MCP-backed tools once available)
  initializeAgentToolRegistry()

  // Create the window
  // Workspace attachment happens via handshake.init based on persisted window→workspace mapping
  const initRenderer = () => {
    // Build menu after window is created
    buildMenu()
  }

  initializeApp((a, m) => {
    getAppService().setReferences(a, m);
    initRenderer()
  })

  // Register all IPC handlers early
  registerAllHandlers(ipcMain)

  // Initialize agent session cleanup
  initAgentSessionsCleanup()

  // Continue heavy initialization after a tick to let the window paint and bridge connect
  setImmediate(async () => {
    try {
      console.time('[main] initializeApp')
      const appService = getAppService()
      await appService.initializeApp()
      console.timeEnd('[main] initializeApp')

      // Index watchers will be started when workspace is attached via handshake.init
    } catch (err) {
      console.error('[main] Initialization failed:', err)
    }
  })

}

// ----------------------------------------------------------------------------
// Single Instance Lock
// Prevent multiple instances from running simultaneously, which can cause
// database locks, IPC conflicts, and file system watcher collisions.
// ----------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.warn('[main] Another instance is already running. Quitting...')
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    const appService = getAppService()
    const mainWindow = appService.getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // Start the application
  initialize()
}

