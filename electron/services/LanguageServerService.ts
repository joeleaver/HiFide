import { Service } from './base/Service.js'
import { LspManager } from './lsp/LspManager.js'
import { 
  type SupportedLspLanguage,
  type LspLanguageListResponse,
  type LspLanguageStatusPayload,
} from '../../shared/lsp.js'
import { type ServerStatus } from './lsp/Protocol.js'
import { LANGUAGE_SERVER_DEFINITIONS } from '../config/languageServers.js'
import { isLspLanguage } from '../../shared/lsp.js'

interface LanguageServerPreferences {
  autoInstall: boolean
  enabledLanguages: Record<string, boolean>
}

interface WorkspaceServerSnapshot {
  servers: Record<string, { status: ServerStatus; lastStartedAt?: number; lastError?: string | null }>
}

interface LanguageServerState {
  workspaces: Record<string, WorkspaceServerSnapshot>
  preferences: LanguageServerPreferences
}

export class LanguageServerService extends Service<LanguageServerState> {
  private managers = new Map<string, LspManager>()

  constructor() {
    super({
      workspaces: {},
      preferences: {
        autoInstall: true,
        enabledLanguages: {}
      }
    }, 'language-server-preferences')
    
    this.applyDefaultLanguagePreferences()
  }

  protected onStateChange(updates: Partial<LanguageServerState>, _prevState: LanguageServerState): void {
    if (updates.preferences) {
      this.persistFields(['preferences'])
    }
  }

  private getManager(workspaceRoot: string): LspManager {
    let manager = this.managers.get(workspaceRoot)
    if (manager) return manager

    manager = new LspManager({
      workspaceRoot,
      onDiagnostics: (params) => {
        this.emit('lsp:diagnostics', {
          workspaceRoot,
          uri: params.uri,
          diagnostics: params.diagnostics
        })
      },
      onStatusChange: (serverKey, status, error) => {
        this.updateWorkspaceStatus(workspaceRoot, serverKey, status, error)
      }
    })

    this.managers.set(workspaceRoot, manager)
    return manager
  }

  private updateWorkspaceStatus(workspaceRoot: string, serverKey: string, status: ServerStatus, error?: string | null) {
    const workspace = this.state.workspaces[workspaceRoot] || { servers: {} }
    const nextServers = {
      ...workspace.servers,
      [serverKey]: {
        status,
        lastStartedAt: status === 'starting' ? Date.now() : workspace.servers[serverKey]?.lastStartedAt,
        lastError: error ?? null
      }
    }
    
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [workspaceRoot]: { servers: nextServers }
      }
    })

    // Broadcast status for all languages handled by this server
    const definition = LANGUAGE_SERVER_DEFINITIONS.find(d => d.key === serverKey)
    if (definition) {
      for (const lang of definition.languages) {
        this.emitLanguageStatus(lang as SupportedLspLanguage)
      }
    }
  }

  private emitLanguageStatus(languageId: SupportedLspLanguage) {
    const payload = this.buildLanguageStatus(languageId)
    this.emit('lsp:languageStatus', payload)
  }

  private buildLanguageStatus(languageId: SupportedLspLanguage): LspLanguageStatusPayload {
    const definition = LANGUAGE_SERVER_DEFINITIONS.find(d => d.languages.includes(languageId))
    if (!definition) {
      return {
        languageId,
        serverKey: 'unknown',
        displayName: languageId,
        status: 'unsupported',
        autoInstallable: false,
        updatedAt: Date.now(),
      }
    }

    const serverKey = definition.key
    // Find the first workspace that has this server, or use a global view
    // For now, we'll just check the first manager or a default status
    let status: LspLanguageStatusPayload['status'] = 'pending'
    let lastError: string | null = null

    for (const workspace of Object.values(this.state.workspaces)) {
      const server = workspace.servers[serverKey]
      if (server) {
        if (server.status === 'ready') status = 'ready'
        else if (server.status === 'starting') status = 'installing'
        else if (server.status === 'error') {
          status = 'error'
          lastError = server.lastError ?? null
        }
      }
    }

    const enabled = this.state.preferences.enabledLanguages[languageId] ?? false
    if (!enabled) status = 'disabled'

    return {
      languageId,
      serverKey,
      displayName: definition.displayName,
      status,
      autoInstallable: definition.provisioning.type === 'npm-npx',
      masonPackage: definition.masonPackage,
      lastError,
      updatedAt: Date.now(),
    }
  }

  private applyDefaultLanguagePreferences(): void {
    const defaults = { ...this.state.preferences.enabledLanguages }
    for (const def of LANGUAGE_SERVER_DEFINITIONS) {
      const shouldEnable = def.provisioning.type === 'builtin'
      for (const lang of def.languages) {
        if (typeof defaults[lang] === 'undefined') {
          defaults[lang] = shouldEnable
        }
      }
    }
    this.setState({ preferences: { ...this.state.preferences, enabledLanguages: defaults } })
  }

  // Facade methods
  async openDocument(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).didOpen(params)
  }

  async changeDocument(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).didChange(params)
  }

  async closeDocument(workspaceRoot: string, path: string) {
    return this.getManager(workspaceRoot).didClose({ path })
  }

  async requestCompletion(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getCompletions(params)
  }

  async requestHover(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getHover(params)
  }

  async requestDefinition(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getDefinition(params)
  }

  async getDefinition(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getDefinition(params)
  }

  async prepareWorkspace(workspaceRoot: string) {
    // Currently, managers are lazily created. 
    // We could pre-warm servers here if needed.
    this.getManager(workspaceRoot)
  }

  async resetWorkspace(workspaceRoot: string) {
    const manager = this.managers.get(workspaceRoot)
    if (manager) {
      await manager.dispose()
      this.managers.delete(workspaceRoot)
    }
  }

  async getReferences(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getReferences(params)
  }

  async getDocumentSymbols(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getDocumentSymbols(params)
  }

  async rename(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).rename(params)
  }

  async getCodeActions(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).getCodeActions(params)
  }

  async formatDocument(workspaceRoot: string, params: any) {
    return this.getManager(workspaceRoot).formatDocument(params)
  }

  async listLanguageStatuses(): Promise<LspLanguageListResponse> {
    const languages: LspLanguageStatusPayload[] = []
    for (const def of LANGUAGE_SERVER_DEFINITIONS) {
      for (const lang of def.languages) {
        languages.push(this.buildLanguageStatus(lang as SupportedLspLanguage))
      }
    }
    return {
      autoInstall: this.state.preferences.autoInstall,
      languages,
    }
  }

  async provisionLanguage(languageId: string): Promise<LspLanguageStatusPayload> {
    const lang = languageId as SupportedLspLanguage
    if (!isLspLanguage(lang)) {
      throw new Error('Unsupported language')
    }
    
    const nextEnabled = { ...this.state.preferences.enabledLanguages, [lang]: true }
    this.setState({ preferences: { ...this.state.preferences, enabledLanguages: nextEnabled } })
    this.emitLanguageStatus(lang)
    return this.buildLanguageStatus(lang)
  }

  setAutoInstall(enabled: boolean): void {
    this.setState({ preferences: { ...this.state.preferences, autoInstall: enabled } })
  }

  async dispose() {
    for (const manager of this.managers.values()) {
      await manager.dispose()
    }
    this.managers.clear()
  }
}
