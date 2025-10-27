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

import { app, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Core modules
import { initializeApp } from './core/app'
import { registerAllHandlers } from './ipc/registry'
import { buildMenu } from './ipc/menu'

// Provider setup
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GeminiProvider } from './providers/gemini'

// State management
import { providers, providerCapabilities } from './core/state'
import { initializeMainStore } from './store'

// Agent dependencies
import { initAgentSessionsCleanup } from './session/agentSessions'
import { agentTools } from './tools'
import { verifyAstGrepAvailable } from './tools/astGrep'

// Environment setup
const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(DIRNAME, '..')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST


// ----------------------------------------------------------------------------
// Global error hardening
// Swallow benign OS pipe errors (e.g., EPIPE from PTY/streams) so they don't
// bubble as uncaught exceptions that zubridge will log and potentially exit on.
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

  // Prefer capture callback so other listeners (e.g., zubridge) don’t see ignorable errors
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
  const msg = reason && (reason as any).stack ? (reason as any).stack : String(reason)
  console.error('[main] unhandledRejection', msg)
})


// Initialize provider adapters
providers.openai = OpenAIProvider as any
providers.anthropic = AnthropicProvider as any
providers.gemini = GeminiProvider as any

// Initialize provider capabilities
providerCapabilities.openai = { tools: true, jsonSchema: true, vision: false, streaming: true }
providerCapabilities.anthropic = { tools: true, jsonSchema: false, vision: false, streaming: true }
providerCapabilities.gemini = { tools: true, jsonSchema: true, vision: true, streaming: true }

// ============================================================================
// AGENT TOOLS REGISTRY
// ============================================================================
// Agent tools are now defined in individual files in electron/tools/
// and aggregated in electron/tools/index.ts
// ============================================================================

// Expose agent tools via globalThis for llm-agent module
;(globalThis as any).__agentTools = agentTools

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Create the window immediately so UI appears fast
  initializeApp(() => {
    // Build menu after window is created
    buildMenu()
  })

  // Register all IPC handlers early
  registerAllHandlers(ipcMain)

  // Initialize agent session cleanup
  initAgentSessionsCleanup()

  // Continue heavy initialization after a tick to let the window paint and bridge connect
  setImmediate(async () => {
    try {
      console.time('[main] verifyAstGrepAvailable')
      await verifyAstGrepAvailable()
      console.timeEnd('[main] verifyAstGrepAvailable')

      console.time('[main] initializeMainStore')
      await initializeMainStore()
      console.timeEnd('[main] initializeMainStore')
    } catch (err) {
      console.error('[main] Post-window initialization failed:', err)
    }
  })

}

// Start the application
initialize()

