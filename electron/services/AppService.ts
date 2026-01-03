/**
 * App Service
 * 
 * Manages application initialization and bootstrap logic.
 */

import { Service } from './base/Service.js'
import {
  getSettingsService,
  getProviderService
} from './index.js'

interface AppState {
  appBootstrapping: boolean
  startupMessage: string | null
  workspaceBoot: Record<string, { bootstrapping: boolean; message: string | null }>
}

export class AppService extends Service<AppState> {
  constructor() {
    super({
      appBootstrapping: true,
      startupMessage: null,
      workspaceBoot: {},
    })
  }

  protected onStateChange(updates: Partial<AppState>): void {
    // App state is transient, no persistence needed

    // Emit events when boot status changes
    if (updates.appBootstrapping !== undefined || updates.startupMessage !== undefined) {
      this.events.emit('app:boot:changed', {
        appBootstrapping: this.state.appBootstrapping,
        startupMessage: this.state.startupMessage,
      })
    }
  }

  // Getters
  isBootstrapping(): boolean {
    return this.state.appBootstrapping
  }

  getStartupMessage(): string | null {
    return this.state.startupMessage
  }

  getWorkspaceBoot(workspaceId: string): { bootstrapping: boolean; message: string | null } {
    return this.state.workspaceBoot[workspaceId] || { bootstrapping: false, message: null }
  }

  // Setters
  setStartupMessage(msg: string | null): void {
    this.setState({ startupMessage: msg })
  }

  setWorkspaceBoot(params: { workspaceId: string; bootstrapping?: boolean; message?: string | null }): void {
    const { workspaceId, bootstrapping, message } = params
    const cur = this.state.workspaceBoot || {}
    const prev = cur[workspaceId] || { bootstrapping: false, message: null }
    this.setState({
      workspaceBoot: {
        ...cur,
        [workspaceId]: {
          bootstrapping: typeof bootstrapping === 'boolean' ? bootstrapping : prev.bootstrapping,
          message: message !== undefined ? message : prev.message,
        },
      },
    })
  }

  // Main initialization
  async initializeApp(): Promise<void> {
    this.setState({ appBootstrapping: true, startupMessage: 'Starting…' })

    const t0 = Date.now()
    const log = (msg: string) => {
      const dt = Date.now() - t0
      console.log(`[app:init +${dt}ms] ${msg}`)
    }

    try {
      // Get services
      const settingsService = getSettingsService()
      const providerService = getProviderService()

      // Flow profiles are now loaded per-workspace during workspace initialization
      // No global initialization needed

      // Workspace initialization happens per-window in workspace-loader.ts
      // when handshake.init is called with workspaceRoot from URL params

      // 2. Load API keys
      const keys = settingsService?.getApiKeys() || {
        openai: '',
        anthropic: '',
        gemini: '',
        fireworks: '',
        xai: '',
      }
      const okey = keys.openai?.trim()
      const akey = keys.anthropic?.trim()
      const gkey = keys.gemini?.trim()
      const fkey = keys.fireworks?.trim()
      const xkey = keys.xai?.trim()
      const orkey = keys.openrouter?.trim()

      // 3. Validate API keys
      let validMap: Record<string, boolean> = {
        openai: false,
        anthropic: false,
        gemini: false,
        fireworks: false,
        xai: false,
        openrouter: false,
      }
      try {
        this.setStartupMessage('Validating provider keys…')
        const t = Date.now()
        if (settingsService?.validateApiKeys) {
          const validationResult = await settingsService.validateApiKeys()
          log(`validateApiKeys done in ${Date.now() - t}ms`)
          if (validationResult && validationResult.ok) {
            validMap.openai = !!okey
            validMap.anthropic = !!akey
            validMap.gemini = !!gkey
            validMap.fireworks = !!fkey
            validMap.xai = !!xkey
            validMap.openrouter = !!orkey
          } else {
            const failures = validationResult?.failures || []
            validMap.openai = !!okey && !failures.some((f: string) => f.toLowerCase().includes('openai'))
            validMap.anthropic = !!akey && !failures.some((f: string) => f.toLowerCase().includes('anthropic'))
            validMap.gemini = !!gkey && !failures.some((f: string) => f.toLowerCase().includes('gemini'))
            validMap.fireworks = !!fkey && !failures.some((f: string) => f.toLowerCase().includes('fireworks'))
            validMap.xai = !!xkey && !failures.some((f: string) => f.toLowerCase().includes('xai'))
            validMap.openrouter = !!orkey && !failures.some((f: string) => f.toLowerCase().includes('openrouter'))
          }
          console.log('[app:init] provider valid map from validateApiKeys', {
            validMap,
            hasKeys: {
              openai: !!okey,
              anthropic: !!akey,
              gemini: !!gkey,
              fireworks: !!fkey,
              xai: !!xkey,
              openrouter: !!orkey,
            },
          })
        } else {
          validMap.openai = !!okey
          validMap.anthropic = !!akey
          validMap.gemini = !!gkey
          validMap.fireworks = !!fkey
          validMap.xai = !!xkey
          validMap.openrouter = !!orkey
        }
      } catch (e) {
        console.error('[app] Failed to validate API keys:', e)
        validMap.openai = !!okey
        validMap.anthropic = !!akey
        validMap.gemini = !!gkey
        validMap.fireworks = !!fkey
        validMap.xai = !!xkey
        validMap.openrouter = !!orkey
      }

      // 4. Update provider validation state
      if (providerService?.setProvidersValid) {
        providerService.setProvidersValid(validMap)
      }

      // 5. Refresh models (now that we have valid keys)
      // Don't await this; let it run in background so app boot isn't blocked
      providerService.refreshAllModels().catch((e: any) => console.error('[app] Failed to refresh models:', e))

      // Sessions are NOT loaded at startup - they are loaded when workspace.open is called

      // Clear startup banner if we have at least one valid provider
      try {
        const hasValidProvider =
          validMap.openai || validMap.anthropic || validMap.gemini || validMap.fireworks || validMap.xai || validMap.openrouter
        if (hasValidProvider) {
          this.setState({ startupMessage: null })
        } else {
          this.setState({ startupMessage: 'No valid API keys found. Open Settings to configure providers.' })
        }
      } catch (e) {
        console.error('[app] Failed to check provider validity:', e)
      }
    } catch (e) {
      console.error('[app] Initialization failed:', e)
      this.setState({ startupMessage: 'Failed to initialize application. Please refresh.' })
    } finally {
      log('Initialization complete')
      this.setState({ appBootstrapping: false })
    }
  }
}

