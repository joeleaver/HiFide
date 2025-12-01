/**
 * App Service
 * 
 * Manages application initialization and bootstrap logic.
 */

import { Service } from './base/Service.js'
import {
  getSettingsService,
  getProviderService,
  getIndexingService
} from './index.js'
import { getIndexer } from '../core/state.js'

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
      const indexingService = getIndexingService()

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

      // 3. Validate API keys
      let validMap: Record<string, boolean> = {
        openai: false,
        anthropic: false,
        gemini: false,
        fireworks: false,
        xai: false,
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
          } else {
            const failures = validationResult?.failures || []
            validMap.openai = !!okey && !failures.some((f: string) => f.toLowerCase().includes('openai'))
            validMap.anthropic = !!akey && !failures.some((f: string) => f.toLowerCase().includes('anthropic'))
            validMap.gemini = !!gkey && !failures.some((f: string) => f.toLowerCase().includes('gemini'))
            validMap.fireworks = !!fkey && !failures.some((f: string) => f.toLowerCase().includes('fireworks'))
            validMap.xai = !!xkey && !failures.some((f: string) => f.toLowerCase().includes('xai'))
          }
          console.log('[app:init] provider valid map from validateApiKeys', {
            validMap,
            hasKeys: {
              openai: !!okey,
              anthropic: !!akey,
              gemini: !!gkey,
              fireworks: !!fkey,
              xai: !!xkey,
            },
          })
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
      if (providerService?.setProvidersValid) {
        providerService.setProvidersValid(validMap)
      }

      // 5. Refresh models (now that we have valid keys)
      // Don't await this; let it run in background so app boot isn't blocked
      providerService.refreshAllModels().catch((e: any) => console.error('[app] Failed to refresh models:', e))

      // Sessions are NOT loaded at startup - they are loaded when workspace.open is called
      // Workspace-scoped initialization (indexing, subscriptions) happens per-window in workspace-loader.ts

      // Non-blocking index check removed - now happens per-workspace in workspace-loader.ts
      // This allows each window to have its own workspace with independent indexing
      if (false) {
        try {
          this.setStartupMessage('Checking code index…')
          if (indexingService?.refreshIndexStatus) await indexingService.refreshIndexStatus()

          // Check if index exists and is usable
          const indexStatus = indexingService?.getStatus()

          if (!indexStatus?.ready || (indexStatus?.chunks || 0) === 0) {
            // No index or unusable - start background rebuild immediately (high priority)
            log('No usable index found, starting high-priority background rebuild')
            if (indexingService?.startBackgroundRebuild) {
              // Don't await - let it run in background
              indexingService.startBackgroundRebuild({ priority: 'high' }).catch((e: any) => {
                console.error('[app] Background rebuild failed:', e)
              })
            }
          } else {
            // Index exists - check if rebuild needed (TTL, model change, etc.)
            const shouldRebuild = await (async () => {
              try {
                const indexer = await getIndexer()
                const cfg = indexingService?.getAutoRefresh() || {}
                const now = Date.now()
                const last = indexingService?.getLastRebuildAt() || 0

                // Check model change
                if (cfg.modelChangeTrigger && indexStatus) {
                  const ei = await indexer.getEngineInfo()
                  if (
                    indexStatus.modelId &&
                    indexStatus.dim &&
                    (ei.id !== indexStatus.modelId || ei.dim !== indexStatus.dim)
                  ) {
                    log(`Index model changed (${indexStatus.modelId}/${indexStatus.dim} -> ${ei.id}/${ei.dim})`)
                    return true
                  }
                }

                // Check TTL
                const ttlMs = Math.max(1, cfg.ttlMinutes || 120) * 60_000
                if (last > 0 && now - last > ttlMs) {
                  log(`Index TTL expired (last rebuild: ${new Date(last).toISOString()})`)
                  return true
                }

                return false
              } catch (e) {
                console.error('[app] Failed to check if rebuild needed:', e)
                return false
              }
            })()

            if (shouldRebuild) {
              log('Index rebuild needed, starting low-priority background rebuild')
              if (indexingService?.startBackgroundRebuild) {
                // Don't await - let it run in background
                indexingService.startBackgroundRebuild({ priority: 'low' }).catch((e: any) => {
                  console.error('[app] Background rebuild failed:', e)
                })
              }
            } else {
              log('Index is up-to-date, no rebuild needed')
            }
          }
        } catch (e) {
          console.error('[app] Index check failed:', e)
        }
      }

      // Clear startup banner if we have at least one valid provider
      try {
        const hasValidProvider =
          validMap.openai || validMap.anthropic || validMap.gemini || validMap.fireworks || validMap.xai
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

