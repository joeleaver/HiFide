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
    set({ appBootstrapping: true, startupMessage: null })
    
    try {
      // Get the full state (will have access to other slices when combined)
      const state = get() as any
      
      // 1. Initialize workspace (main-process only)
      // Use persisted workspaceRoot if available; otherwise default to process.cwd()
      try {
        const savedRoot: string | null = state.workspaceRoot || null
        const root = savedRoot || process.cwd()

        // Ensure workspace folders exist and minimal context is generated
        try {
          const { bootstrapWorkspace } = await import('../utils/workspace-helpers')
          await bootstrapWorkspace({ baseDir: root, preferAgent: false, overwrite: false })
        } catch (e) {
          console.error('[app] bootstrapWorkspace failed:', e)
        }

        // Set the workspace root in state if it wasn't already set
        if (!savedRoot && state.setWorkspaceRoot) {
          state.setWorkspaceRoot(root)
        }
      } catch (e) {
        console.error('[app] Failed to initialize workspace:', e)
      }
      
      // 2. Load API keys from store (already loaded from persistence via Zustand middleware)
      const keys = state.settingsApiKeys || { openai: '', anthropic: '', gemini: '' }
      const okey = keys.openai?.trim()
      const akey = keys.anthropic?.trim()
      const gkey = keys.gemini?.trim()

      
      // 3. Validate API keys using the settings slice action
      let validMap: Record<string, boolean> = {
        openai: false,
        anthropic: false,
        gemini: false,
      }

      try {
        // Call validateApiKeys from settings slice
        if (state.validateApiKeys) {
          const validationResult = await state.validateApiKeys()

          // If validation succeeded, mark providers with keys as valid
          if (validationResult && validationResult.ok) {
            validMap.openai = !!okey
            validMap.anthropic = !!akey
            validMap.gemini = !!gkey
          } else {
            // Parse failures to determine which providers are valid
            const failures = validationResult?.failures || []
            validMap.openai = !!okey && !failures.some((f: string) => f.toLowerCase().includes('openai'))
            validMap.anthropic = !!akey && !failures.some((f: string) => f.toLowerCase().includes('anthropic'))
            validMap.gemini = !!gkey && !failures.some((f: string) => f.toLowerCase().includes('gemini'))
          }
        } else {
          // Fallback: assume keys are valid if they exist
          validMap.openai = !!okey
          validMap.anthropic = !!akey
          validMap.gemini = !!gkey
        }
      } catch (e) {
        console.error('[app] Failed to validate API keys:', e)
        // On error, assume keys are valid if they exist
        validMap.openai = !!okey
        validMap.anthropic = !!akey
        validMap.gemini = !!gkey
      }

      // 4. Update provider validation state (from provider slice)
      if (state.setProvidersValid) {
        state.setProvidersValid(validMap)
      }

      
      // 5. Load models for valid providers (parallel)
      try {
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
              // Clear models for invalid providers
              if (state.setModelsForProvider) {
                state.setModelsForProvider({ provider: p, models: [] })
              }
            }
          })
        )
      } catch (e) {
        console.error('[app] Failed to load models:', e)
      }
      
      // 6. Check if any providers are valid
      const hasValidProvider = validMap.openai || validMap.anthropic || validMap.gemini
      
      if (!hasValidProvider) {
        set({ startupMessage: 'No valid API keys found. Please configure providers in Settings.' })
        
        // Navigate to settings view
        try {
          if (state.setCurrentView) {
            state.setCurrentView('settings')
          }
        } catch (e) {
          console.error('[app] Failed to set current view:', e)
        }
      }
      
      // 7. Load sessions from files
      try {
        if (state.loadSessions) {
          await state.loadSessions()
        }

        // Ensure at least one session exists
        let createdNewSession = false
        try {
          if (state.ensureSessionPresent) {
            createdNewSession = state.ensureSessionPresent()
          }
        } catch (e) {
          console.error('[app] Failed to ensure session present:', e)
        }

        // Initialize the current session (loads flow, resumes if paused)
        // Only if we didn't create a new session (newSession already initializes)
        if (!createdNewSession) {
          try {
            if (state.initializeSession) {
              await state.initializeSession()
            }
          } catch (e) {
            console.error('[app] Failed to initialize session:', e)
          }
        }
      } catch (e) {
        console.error('[app] Failed to load sessions during init:', e)
      }

      // 8. Initialize subscriptions
      try {
        if (state.ensureIndexProgressSubscription) {
          state.ensureIndexProgressSubscription()
        }
      } catch (e) {
        console.error('[app] Failed to initialize subscriptions:', e)
      }

    } catch (e) {
      console.error('[app] Initialization failed:', e)
      set({ startupMessage: 'Failed to initialize application. Please refresh.' })
    } finally {
      set({ appBootstrapping: false })
    }
  },
})

