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
import { registerRateLimitIpc } from './providers/ratelimit'
import type { AgentTool } from './providers/provider'

// Additional imports for agent tools helpers

// State management
import { providers, providerCapabilities } from './core/state'

// Agent dependencies
import { initAgentSessionsCleanup } from './session/agentSessions'

// Environment setup
const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(DIRNAME, '..')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Initialize provider adapters (register constructors)
providers.openai = OpenAIProvider as any
// ----------------------------------------------------------------------------
// Helper functions used by agent tools (ported from legacy main.ts)
// ----------------------------------------------------------------------------


providers.anthropic = AnthropicProvider as any
providers.gemini = GeminiProvider as any

// Initialize provider capabilities
providerCapabilities.openai = { tools: true, jsonSchema: true, vision: false, streaming: true }
providerCapabilities.anthropic = { tools: true, jsonSchema: false, vision: false, streaming: true }
providerCapabilities.gemini = { tools: true, jsonSchema: true, vision: true, streaming: true }

// ============================================================================
// AGENT TOOLS REGISTRY
// ============================================================================
// TODO: Extract this to electron/agent/tools.ts in a future iteration
// This is ~1,026 lines and will be refactored separately
// For now, it's exposed via globalThis for access by llm-agent module
// ============================================================================

const agentTools: AgentTool[] = [
  // NOTE: Agent tools definition will be inserted here
  // This is a placeholder - the actual tools are still in the original main.ts
  // and need to be copied over
]

// Expose agent tools via globalThis for llm-agent module
;(globalThis as any).__agentTools = agentTools

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

/**
 * Initialize the application
 */
function initialize(): void {
  // Register all IPC handlers
  registerAllHandlers(ipcMain)

  // Register rate limit IPC handlers
  registerRateLimitIpc(ipcMain)

  // Initialize agent session cleanup
  initAgentSessionsCleanup()

  // Initialize app lifecycle and create window
  initializeApp(() => {
    // Build menu after window is created
    buildMenu()
  })

}

// Start the application
initialize()

