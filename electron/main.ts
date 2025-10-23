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

import { ipcMain } from 'electron'
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

