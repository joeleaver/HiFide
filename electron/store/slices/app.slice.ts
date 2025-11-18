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
  // Per-workspace boot state (isolation for multi-window)
  workspaceBoot: Record<string, { bootstrapping: boolean; message: string | null }>

  // Actions
  initializeApp: () => Promise<void>
  setStartupMessage: (msg: string | null) => void
  setWorkspaceBoot: (params: { workspaceId: string; bootstrapping?: boolean; message?: string | null }) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createAppSlice: StateCreator<AppSlice, [], [], AppSlice> = (set, get) => ({
  // State
  appBootstrapping: true,
  startupMessage: null,
  workspaceBoot: {},

  // Actions
  setStartupMessage: (msg: string | null) => {
    set({ startupMessage: msg })
  },
  setWorkspaceBoot: ({ workspaceId, bootstrapping, message }: { workspaceId: string; bootstrapping?: boolean; message?: string | null }) => {
    set((s: any) => {
      const cur = (s as any).workspaceBoot || {}
      const prev = cur[workspaceId] || { bootstrapping: false, message: null }
      return {
        workspaceBoot: {
          ...cur,
          [workspaceId]: {
            bootstrapping: typeof bootstrapping === 'boolean' ? bootstrapping : prev.bootstrapping,
            message: (message !== undefined) ? message : prev.message,
          }
        }
      }
    })
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
      let hasWorkspace = false
      try {
        const savedRoot: string | null = state.workspaceRoot || null
        hasWorkspace = !!savedRoot
        if (hasWorkspace) {
          const root = savedRoot as string
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
        } else {
          log('No workspace configured; entering Welcome mode')
          try { state.setCurrentView?.({ view: 'welcome' }) } catch {}
        }
      } catch (e) {
        console.error('[app] Failed to initialize workspace:', e)
      }

      // 2. Load API keys
      const keys = state.settingsApiKeys || { openai: '', anthropic: '', gemini: '', fireworks: '', xai: '' }
      const okey = keys.openai?.trim()
      const akey = keys.anthropic?.trim()
      const gkey = keys.gemini?.trim()
      const fkey = keys.fireworks?.trim()
      const xkey = (keys as any).xai?.trim()

      // 3. Validate API keys
      let validMap: Record<string, boolean> = { openai: false, anthropic: false, gemini: false, fireworks: false, xai: false }
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
            validMap.fireworks = !!fkey
            validMap.xai = !!xkey
          } else {
            const failures = validationResult?.failures || []
            validMap.openai = !!okey && !failures.some((f: string) => f.toLowerCase().includes('openai'))
            validMap.anthropic = !!akey && !failures.some((f: string) => f.toLowerCase().includes('anthropic'))
            validMap.gemini = !!gkey && !failures.some((f: string) => f.toLowerCase().includes('gemini'))
            validMap.fireworks = !!fkey && !failures.some((f: string) => f.toLowerCase().includes('fireworks'))
            validMap.xai = !!xkey && !failures.some((f: string) => f.toLowerCase().includes('xai'))
          }
        } else {
          validMap.openai = !!okey
          validMap.anthropic = !!akey
          validMap.gemini = !!gkey
          validMap.fireworks = !!fkey
          validMap.xai = !!xkey
        }
      } catch (e) {
        console.error('[app] Failed to validate API keys:', e)
        validMap.openai = !!okey
        validMap.anthropic = !!akey
        validMap.gemini = !!gkey
        validMap.fireworks = !!fkey
      }

      // 4. Update provider validation state
      if (state.setProvidersValid) {
        state.setProvidersValid(validMap)
      }

      // 5. Load models for valid providers (parallel, soft timeouts so boot can't hang)
      try {
        if (state.setStartupMessage) state.setStartupMessage('Loading models…')
        const t = Date.now()

        const withTimeout = (p: Promise<any>, ms: number, onTimeout: () => void): Promise<void> => {
          return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              try { onTimeout() } catch {}
              resolve()
            }, ms)
            p.then(() => { clearTimeout(timer); resolve() })
             .catch(() => { clearTimeout(timer); resolve() })
          })
        }

        const providers: Array<'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai'> = ['openai','anthropic','gemini','fireworks','xai']
        const tasks = providers.map((p) => {
          if (!validMap[p]) {
            try { state.setModelsForProvider?.({ provider: p, models: [] }) } catch {}
            return Promise.resolve()
          }
          // 7s soft timeout per provider
          const work = (async () => {
            try {
              await state.refreshModels?.(p)
            } catch (e) {
              console.error(`[app] Failed to refresh models for ${p}:`, e)
              try { state.setModelsForProvider?.({ provider: p, models: [] }) } catch {}
            }
          })()
          return withTimeout(work, 7000, () => {
            console.warn(`[app] Model refresh timed out for ${p} (continuing boot)`)
            try { state.setModelsForProvider?.({ provider: p, models: [] }) } catch {}
          })
        })

        await Promise.allSettled(tasks)
        log(`models loaded (or timed out) in ${Date.now() - t}ms`)
      } catch (e) {
        console.error('[app] Failed to load models:', e)
      }



      // 7. Load sessions (only when a workspace is set)
      if (hasWorkspace) {
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
      } else {
        // No workspace bound; skip session initialization
      }

      // 8. Subscriptions (workspace-scoped)
      if (hasWorkspace) {
        try {
          if (state.ensureIndexProgressSubscription) state.ensureIndexProgressSubscription()
        } catch (e) {
          console.error('[app] Failed to initialize subscriptions:', e)
        }
      }

      // 9. Indexing gate (workspace-scoped)
      if (hasWorkspace) {
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
      }

      // Clear startup banner if we have at least one valid provider (workspace mode only)
      if (hasWorkspace) {
        try {
          const hasValidProvider = validMap.openai || validMap.anthropic || validMap.gemini || validMap.fireworks || validMap.xai
          if (hasValidProvider) set({ startupMessage: null })
        } catch {}
      }

      // 6. Navigate if no providers (workspace mode only; in Welcome we stay on welcome)
      if (hasWorkspace) {
        try {
          const hasValidProvider = validMap.openai || validMap.anthropic || validMap.gemini || validMap.fireworks || validMap.xai
          if (!hasValidProvider) {
            if (state.setCurrentView) state.setCurrentView({ view: 'settings' })
            set({ startupMessage: 'No valid API keys found. Open Settings to configure providers.' })
          }
        } catch (e) {
          console.error('[app] Failed to set current view (post-indexing):', e)
        }
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
