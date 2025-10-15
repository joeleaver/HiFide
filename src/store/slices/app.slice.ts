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
      
      // 1. Initialize workspace
      // Restore last workspace folder if available; otherwise fall back to main's root
      try {
        const saved = state.workspaceRoot || (typeof localStorage !== 'undefined' ? localStorage.getItem('hifide:folder') : null)
        
        if (saved) {
          await window.workspace?.setRoot?.(saved)
          state.setWorkspaceRoot?.(saved)
          await window.workspace?.bootstrap?.(saved, true, false)
        } else {
          const root = await window.workspace?.getRoot?.()
          if (root) {
            state.setWorkspaceRoot?.(root)
            await window.workspace?.bootstrap?.(root, true, false)
          }
        }
      } catch (e) {
        console.error('[app] Failed to initialize workspace:', e)
      }
      
      // 2. Load and validate API keys
      // Keys are stored in electron-store in main process
      let okey: string | null | undefined = null
      let akey: string | null | undefined = null
      let gkey: string | null | undefined = null
      
      try {
        [okey, akey, gkey] = await Promise.all([
          window.secrets?.getApiKeyFor?.('openai'),
          window.secrets?.getApiKeyFor?.('anthropic'),
          window.secrets?.getApiKeyFor?.('gemini'),
        ])
      } catch (e) {
        console.error('[app] Failed to load API keys:', e)
      }
      
      console.debug('[app] API keys loaded', {
        openai: !!okey,
        anthropic: !!akey,
        gemini: !!gkey,
      })
      
      // 3. Validate API keys in parallel
      const providers: Array<{ id: 'openai' | 'anthropic' | 'gemini'; key: string | null | undefined }> = [
        { id: 'openai', key: okey },
        { id: 'anthropic', key: akey },
        { id: 'gemini', key: gkey },
      ]
      
      let results: Array<{ provider: 'openai' | 'anthropic' | 'gemini'; ok: boolean }> = []
      
      try {
        results = await Promise.all(
          providers.map(async (p) => {
            const k = (p.key || '').toString().trim()
            if (!k) return { provider: p.id, ok: false }
            
            try {
              const v = await window.secrets?.validateApiKeyFor?.(
                p.id,
                k,
                p.id === 'anthropic' ? 'claude-3-5-sonnet' : (p.id === 'gemini' ? 'gemini-1.5-pro' : undefined)
              )
              return { provider: p.id, ok: !!v?.ok }
            } catch (e) {
              console.error(`[app] Failed to validate ${p.id} API key:`, e)
              return { provider: p.id, ok: false }
            }
          })
        )
      } catch (e) {
        console.error('[app] Failed to validate API keys:', e)
      }
      
      // 4. Update provider validation state
      const validMap: Record<string, boolean> = {
        openai: false,
        anthropic: false,
        gemini: false,
      }
      
      for (const r of results) {
        validMap[r.provider] = r.ok
      }
      
      // Update provider validation state (from provider slice)
      if (state.setProvidersValid) {
        state.setProvidersValid(validMap)
      }
      
      console.debug('[app] Provider validation results:', validMap)
      
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
                state.setModelsForProvider(p, [])
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
        try {
          if (state.ensureSessionPresent) {
            state.ensureSessionPresent()
          }
        } catch (e) {
          console.error('[app] Failed to ensure session present:', e)
        }

        // Initialize the current session (loads flow, resumes if paused)
        try {
          if (state.initializeSession) {
            await state.initializeSession()
          }
        } catch (e) {
          console.error('[app] Failed to initialize session:', e)
        }
      } catch (e) {
        console.error('[app] Failed to load sessions during init:', e)
      }
      
      console.debug('[app] Initialization complete')
    } catch (e) {
      console.error('[app] Initialization failed:', e)
      set({ startupMessage: 'Failed to initialize application. Please refresh.' })
    } finally {
      set({ appBootstrapping: false })
    }
  },
})

