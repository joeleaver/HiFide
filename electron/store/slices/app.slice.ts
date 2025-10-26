/**
 * App Slice
 *
 * Manages application initialization and bootstrap logic.
 *
 * Responsibilities:
 * - Handle app startup and initialization
 * - Coordinate workspace, API keys, and session loading
 * - Manage bootstrap state and messages
 * - Orchestrate initial provider validation
 *
 * Dependencies:
 * - Workspace slice (for workspace initialization)
 * - Session slice (for session loading)
 * - Provider slice (for model loading and validation)
 * - Settings slice (for API key loading)
 * - View slice (for setting initial view)
 */

import type { StateCreator } from 'zustand'

// ============================================================================
// Types
// ============================================================================

export interface AppSlice {
  // State
  appBootstrapping: boolean
  startupMessage: string | null

  // Actions
  initializeApp: () => Promise<void>
  setStartupMessage: (msg: string | null) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createAppSlice: StateCreator<AppSlice, [], [], AppSlice> = (set, get) => ({
  // State
  appBootstrapping: true,
  startupMessage: null,

  // Actions
  setStartupMessage: (msg: string | null) => {
    set({ startupMessage: msg })
  },

  initializeApp: async () => {
    set({ appBootstrapping: true, startupMessage: 'Starting…' })

    const t0 = Date.now()
    const log = (msg: string) => {
      const dt = Date.now() - t0
      console.log(`[app:init +${dt}ms] ${msg}`)
    }

    try {
      const state = get() as any

      // 1. Initialize workspace (main-process only)
      try {
        const savedRoot: string | null = state.workspaceRoot || null
        const root = savedRoot || process.cwd()
        log(`Workspace root resolved: ${root}`)

        if (state.setStartupMessage) state.setStartupMessage('Preparing workspace…')
        try {
          if (state.ensureWorkspaceReady) {
            const t = Date.now()
            await state.ensureWorkspaceReady({ baseDir: root, preferAgent: false, overwrite: false })
            log(`ensureWorkspaceReady done in ${Date.now() - t}ms`)
          }
        } catch (e) {
          console.error('[app] ensureWorkspaceReady failed:', e)
        }

        if (!savedRoot && state.setWorkspaceRoot) {
          state.setWorkspaceRoot(root)
        }
      } catch (e) {
        console.error('[app] Failed to initialize workspace:', e)
      }

      // 2. Load API keys
      const keys = state.settingsApiKeys || { openai: '', anthropic: '', gemini: '' }
      const okey = keys.openai?.trim()
      const akey = keys.anthropic?.trim()
      const gkey = keys.gemini?.trim()

      // 3. Validate API keys
      let validMap: Record<string, boolean> = { openai: false, anthropic: false, gemini: false }
      try {
        if (state.setStartupMessage) state.setStartupMessage('Validating provider keys…')
        const t = Date.now()
        if (state.validateApiKeys) {
          const validationResult = await state.validateApiKeys()
          log(`validateApiKeys done in ${Date.now() - t}ms`)
          if (validationResult && validationResult.ok) {
            validMap.openai = !!okey
            validMap.anthropic = !!akey
            validMap.gemini = !!gkey
          } else {
            const failures = validationResult?.failures || []
            validMap.openai = !!okey && !failures.some((f: string) => f.toLowerCase().includes('openai'))
            validMap.anthropic = !!akey && !failures.some((f: string) => f.toLowerCase().includes('anthropic'))
            validMap.gemini = !!gkey && !failures.some((f: string) => f.toLowerCase().includes('gemini'))
          }
        } else {
          validMap.openai = !!okey
          validMap.anthropic = !!akey
          validMap.gemini = !!gkey
        }
      } catch (e) {
        console.error('[app] Failed to validate API keys:', e)
        validMap.openai = !!okey
        validMap.anthropic = !!akey
        validMap.gemini = !!gkey
      }

      // 4. Update provider validation state
      if (state.setProvidersValid) {
        state.setProvidersValid(validMap)
      }

      // 5. Load models for valid providers (parallel)
      try {
        if (state.setStartupMessage) state.setStartupMessage('Loading models…')
        const t = Date.now()
        await Promise.all(
          (['openai', 'anthropic', 'gemini'] as const).map(async (p) => {
            if (validMap[p]) {
              try {
                if (state.refreshModels) {
                  await state.refreshModels(p)
                }
              } catch (e) {
                console.error(`[app] Failed to refresh models for ${p}:`, e)
              }
            } else {
              if (state.setModelsForProvider) {
                state.setModelsForProvider({ provider: p, models: [] })
              }
            }
          })
        )
        log(`models loaded in ${Date.now() - t}ms`)
      } catch (e) {
        console.error('[app] Failed to load models:', e)
      }



      // 7. Load sessions
      try {
        if (state.setStartupMessage) state.setStartupMessage('Loading sessions…')
        const t = Date.now()
        if (state.loadSessions) await state.loadSessions()
        let createdNewSession = false
        try {
          if (state.ensureSessionPresent) {
            createdNewSession = state.ensureSessionPresent()
          }
        } catch (e) {
          console.error('[app] Failed to ensure session present:', e)
        }
        if (!createdNewSession) {
          try {
            if (state.setStartupMessage) state.setStartupMessage('Initializing session…')
            if (state.initializeSession) await state.initializeSession()
          } catch (e) {
            console.error('[app] Failed to initialize session:', e)
          }
        }
        log(`sessions ready in ${Date.now() - t}ms`)
      } catch (e) {
        console.error('[app] Failed to load sessions during init:', e)
      }

      // 8. Subscriptions
      try {
        if (state.ensureIndexProgressSubscription) state.ensureIndexProgressSubscription()
      } catch (e) {
        console.error('[app] Failed to initialize subscriptions:', e)
      }

      // 9. Indexing gate
      try {
        if (state.setStartupMessage) state.setStartupMessage('Checking code index…')
        if (state.refreshIndexStatus) await state.refreshIndexStatus()
        if (state.maybeAutoRebuildAndWait) {
          const t = Date.now()
          await state.maybeAutoRebuildAndWait()
          log(`indexing gate done in ${Date.now() - t}ms`)
        }
      } catch (e) {
        console.error('[app] Indexing gate failed:', e)
      }

      // Clear startup banner if we have at least one valid provider
      try {
        const hasValidProvider = validMap.openai || validMap.anthropic || validMap.gemini
        if (hasValidProvider) set({ startupMessage: null })
      } catch {}

      // 6. Navigate if no providers (after indexing so startup stays in loading screen)
      try {
        const hasValidProvider = validMap.openai || validMap.anthropic || validMap.gemini
        if (!hasValidProvider) {
          if (state.setCurrentView) state.setCurrentView({ view: 'settings' })
          set({ startupMessage: 'No valid API keys found. Open Settings to configure providers.' })
        }
      } catch (e) {
        console.error('[app] Failed to set current view (post-indexing):', e)
      }

    } catch (e) {
      console.error('[app] Initialization failed:', e)
      set({ startupMessage: 'Failed to initialize application. Please refresh.' })
    } finally {
      log('Initialization complete')
      set({ appBootstrapping: false })
    }
  },
})
