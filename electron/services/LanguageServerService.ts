import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { unzipSync } from 'fflate'
import { Service } from './base/Service.js'
import type {
  SupportedLspLanguage,
  LspDocumentParams,
  LspCompletionRequest,
  LspHoverRequest,
  LspDefinitionRequest,
  LspDiagnosticsEvent,
  LspLanguageListResponse,
  LspLanguageStatusPayload,
} from '../../shared/lsp.js'
import { isLspLanguage } from '../../shared/lsp.js'
import {
  type InitializeResult,
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  CompletionRequest,
  HoverRequest,
  DefinitionRequest,
  PublishDiagnosticsNotification,
  type CompletionItem,
  type CompletionList,
  type CompletionParams,
  type Hover,
  type Definition,
  type PublishDiagnosticsParams,
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'
import { MessageConnection, StreamMessageReader, StreamMessageWriter, createMessageConnection } from 'vscode-jsonrpc/node.js'
import { URI } from 'vscode-uri'
import { LANGUAGE_SERVER_DEFINITIONS, type LanguageServerDefinition } from '../config/languageServers.js'

const require = createRequire(import.meta.url)

type ServerKey = (typeof LANGUAGE_SERVER_DEFINITIONS)[number]['key']
type ServerStatus = 'idle' | 'starting' | 'ready' | 'stopped' | 'error'

interface WorkspaceServerSnapshot {
  servers: Record<string, { status: ServerStatus; lastStartedAt?: number; lastError?: string | null }>
}

interface LanguageServerPreferences {
  autoInstall: boolean
  enabledLanguages: Record<string, boolean>
}

interface LanguageServerState {
  workspaces: Record<string, WorkspaceServerSnapshot>
  preferences: LanguageServerPreferences
}

interface DocumentState {
  path: string
  uri: string
  languageId: SupportedLspLanguage
  serverKey: ServerKey
  version: number
  text: string
}

interface CompletionResultPayload {
  items: CompletionList | CompletionItem[] | null
}

interface LaunchConfig {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  initializationOptions?: any
}

interface MasonPackageEntry {
  name: string
  source?: { id?: string; extra_packages?: string[] }
  bin?: Record<string, string>
  languages?: string[]
  homepage?: string
}

interface ServerRuntimeSnapshot {
  status: ServerStatus
  lastError?: string | null
}

const SERVER_DEFINITION_BY_KEY = new Map<ServerKey, LanguageServerDefinition>()
const LANGUAGE_TO_SERVER: Partial<Record<SupportedLspLanguage, ServerKey>> = {}
for (const definition of LANGUAGE_SERVER_DEFINITIONS) {
  SERVER_DEFINITION_BY_KEY.set(definition.key as ServerKey, definition)
  for (const languageId of definition.languages) {
    LANGUAGE_TO_SERVER[languageId] = definition.key as ServerKey
  }
}

function resolveWorkspaceRequire(workspaceRoot: string) {
  return createRequire(path.join(workspaceRoot, 'package.json'))
}

function resolvePackageBin(workspaceRoot: string, packageName: string): string | null {
  console.log(`[LanguageServerService] Resolving bin for ${packageName} in ${workspaceRoot}`)
  const workspaceRequire = resolveWorkspaceRequire(workspaceRoot)
  const resolve = (id: string) => {
    try {
      const res = workspaceRequire.resolve(id)
      console.log(`[LanguageServerService] Resolved ${id} via workspace: ${res}`)
      return res
    } catch {
      try {
        const res = require.resolve(id)
        console.log(`[LanguageServerService] Resolved ${id} via fallback: ${res}`)
        return res
      } catch {
        console.log(`[LanguageServerService] Failed to resolve ${id}`)
        return null
      }
    }
  }

  const pkgJsonPath = resolve(`${packageName}/package.json`)
  if (!pkgJsonPath) return null

  try {
    const pkg = (path.isAbsolute(pkgJsonPath) ? require(pkgJsonPath) : workspaceRequire(pkgJsonPath)) as {
      bin?: string | Record<string, string>
    }
    const binEntry =
      typeof pkg.bin === 'string'
        ? pkg.bin
        : pkg.bin?.[packageName] ?? pkg.bin?.default ?? (typeof pkg.bin === 'object' ? Object.values(pkg.bin)[0] : null)
    
    if (!binEntry) {
      console.log(`[LanguageServerService] No bin entry found for ${packageName} in ${pkgJsonPath}`)
      return null
    }
    const resolvedBin = path.resolve(path.dirname(pkgJsonPath), binEntry)
    console.log(`[LanguageServerService] Resolved bin for ${packageName}: ${resolvedBin}`)
    return resolvedBin
  } catch (err) {
    console.error(`[LanguageServerService] Error reading package.json for ${packageName}:`, err)
    return null
  }
}

function resolveTsserverPath(workspaceRoot: string): string | null {
  console.log(`[LanguageServerService] Resolving tsserver path in ${workspaceRoot}`)
  const workspaceRequire = resolveWorkspaceRequire(workspaceRoot)
  const resolve = (id: string) => {
    try {
      return workspaceRequire.resolve(id)
    } catch {
      try {
        return require.resolve(id)
      } catch {
        return null
      }
    }
  }

  const tsPkgJsonPath = resolve('typescript/package.json')
  if (!tsPkgJsonPath) {
    console.log(`[LanguageServerService] Could not find typescript/package.json`)
    return null
  }
  const resolvedPath = path.resolve(path.dirname(tsPkgJsonPath), 'lib', 'tsserver.js')
  console.log(`[LanguageServerService] Resolved tsserver.js: ${resolvedPath}`)
  return resolvedPath
}

function resolveNodeCommandEnv(workspaceRoot: string): { command: string; env?: NodeJS.ProcessEnv } {
  const env: Record<string, string> = { ...process.env } as any
  
  // Ensure Electron-specific Node.js mode
  if (process.versions?.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  // Clean up NODE_OPTIONS which might interfere with child processes in some environments
  delete env.NODE_OPTIONS

  // Inject NODE_PATH to help the server find local modules and plugins
  const workspaceNodeModules = path.join(workspaceRoot, 'node_modules')
  const existingNodePath = env.NODE_PATH
  env.NODE_PATH = existingNodePath 
    ? `${workspaceNodeModules}${path.delimiter}${existingNodePath}`
    : workspaceNodeModules

  return { command: process.execPath, env }
}

function normalizeWorkspaceRoot(root: string): string {
  try {
    return path.resolve(root)
  } catch {
    return root
  }
}

function normalizeTriggerKind(kind?: number): CompletionTriggerKind {
  if (kind === CompletionTriggerKind.TriggerCharacter || kind === CompletionTriggerKind.TriggerForIncompleteCompletions) {
    return kind
  }
  return CompletionTriggerKind.Invoked
}

function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

function normalizeLanguageId(languageId?: string | null): SupportedLspLanguage | null {
  if (!languageId) return null
  const normalized = languageId.toLowerCase() as SupportedLspLanguage
  return isLspLanguage(normalized) ? normalized : null
}

class LanguageServerInstance {
  private connection: MessageConnection | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private readyPromise: Promise<void> | null = null
  private disposed = false
  private status: ServerStatus = 'idle'

  constructor(
    private readonly workspaceRoot: string,
    private readonly serverKey: ServerKey,
    private readonly resolveLaunchConfig: () => Promise<LaunchConfig>,
    private readonly onDiagnostics: (params: PublishDiagnosticsParams) => void,
    private readonly onStatusChange: (status: ServerStatus, meta?: { error?: string | null }) => void,
  ) {}

  getStatus(): ServerStatus {
    return this.status
  }

  async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error('[LanguageServerService] Server disposed')
    if (this.status === 'ready') return
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = this.start()
    await this.readyPromise
  }

  private async start(): Promise<void> {
    this.status = 'starting'
    this.onStatusChange('starting')

    const launch = await this.resolveLaunchConfig()
    console.log(`[LanguageServerService] Starting ${this.serverKey} server:`, {
      command: launch.command,
      args: launch.args,
      cwd: this.workspaceRoot,
      env_NODE_PATH: launch.env?.NODE_PATH,
    })

    const child = spawn(launch.command, launch.args, {
      cwd: this.workspaceRoot,
      env: { ...process.env, ...(launch.env ?? {}) },
      stdio: 'pipe',
    })
    this.child = child

    child.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()
      if (message) {
        console.debug(`[LanguageServerService] ${this.serverKey} stderr: ${message}`)
      }
    })

    child.on('exit', (code, signal) => {
      this.status = 'stopped'
      this.onStatusChange('stopped', { error: code || signal ? `exit ${code ?? ''} ${signal ?? ''}` : null })
      this.dispose().catch(() => {})
    })

    const reader = new StreamMessageReader(child.stdout)
    const writer = new StreamMessageWriter(child.stdin)
    const connection = createMessageConnection(reader, writer)
    this.connection = connection

    connection.onNotification(PublishDiagnosticsNotification.method, (params: PublishDiagnosticsParams) => {
      this.onDiagnostics(params)
    })

    connection.onError((error) => {
      console.error('[LanguageServerService] Connection error:', error)
      this.onStatusChange('error', { error: error instanceof Error ? error.message : String(error) })
    })

    connection.listen()

    const rootUri = pathToFileURL(this.workspaceRoot).toString()
    const definition = SERVER_DEFINITION_BY_KEY.get(this.serverKey)
    
    const initializeParams = {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
          completion: { completionItem: { documentationFormat: ['markdown', 'plaintext'], snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { dynamicRegistration: false },
        },
        workspace: {
          configuration: true,
          didChangeWatchedFiles: { dynamicRegistration: false },
        },
      },
      workspaceFolders: [
        {
          name: path.basename(this.workspaceRoot),
          uri: rootUri,
        },
      ],
      initializationOptions: {
        ...(definition?.initializationOptions ?? {}),
        ...(launch.initializationOptions ?? {}),
        preferences: {
          includePackageJsonAutoImports: 'auto',
          includeCompletionsForModuleExports: true,
          includeCompletionsWithSnippetText: true,
          ...(definition?.initializationOptions?.preferences ?? {}),
          ...(launch.initializationOptions?.preferences ?? {}),
        },
      },
    }

    console.log(`[LanguageServerService] Sending InitializeRequest for ${this.serverKey}:`, JSON.stringify(initializeParams, null, 2))
    const result = await connection.sendRequest<InitializeResult>(InitializeRequest.method, initializeParams)
    if (!result) {
      throw new Error('[LanguageServerService] Failed to initialize language server')
    }
    console.log(`[LanguageServerService] Server ${this.serverKey} initialized with capabilities:`, JSON.stringify(result.capabilities, null, 2))
    connection.sendNotification(InitializedNotification.method, {})
    this.status = 'ready'
    this.onStatusChange('ready')
  }

  async sendRequest<TResult>(method: string, params: any): Promise<TResult> {
    await this.ensureReady()
    if (!this.connection) throw new Error('[LanguageServerService] Connection not ready')
    return this.connection.sendRequest<TResult>(method, params)
  }

  async sendNotification(method: string, params: any): Promise<void> {
    await this.ensureReady()
    if (!this.connection) throw new Error('[LanguageServerService] Connection not ready')
    this.connection.sendNotification(method, params)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      if (this.connection) {
        try {
          await this.connection.sendRequest(ShutdownRequest.method, {})
        } catch {}
        try {
          this.connection.sendNotification(ExitNotification.method)
        } catch {}
        try {
          this.connection.dispose()
        } catch {}
      }
    } finally {
      if (this.child && !this.child.killed) {
        try { this.child.kill() } catch {}
      }
      this.connection = null
      this.child = null
      this.status = 'stopped'
    }
  }
}

class WorkspaceLanguageHost {
  private readonly documents = new Map<string, DocumentState>()
  private readonly servers = new Map<ServerKey, LanguageServerInstance>()

  constructor(
    private readonly workspaceRoot: string,
    private readonly emitDiagnostics: (payload: LspDiagnosticsEvent) => void,
    private readonly updateSnapshot: (serverKey: ServerKey, status: ServerStatus, meta?: { error?: string | null }) => void,
    private readonly resolveLaunchConfig: (serverKey: ServerKey, workspaceRoot: string) => Promise<LaunchConfig>,
  ) {}

  private toAbsolutePath(input: string): string {
    const resolved = path.isAbsolute(input) ? input : path.join(this.workspaceRoot, input)
    const normalized = path.resolve(resolved)
    const relative = path.relative(this.workspaceRoot, normalized)
    if (relative && relative.startsWith('..')) {
      throw new Error(`[LanguageServerService] File escapes workspace root: ${input}`)
    }
    return normalized
  }

  private toDocumentUri(filePath: string): string {
    return URI.file(filePath).toString()
  }

  private ensureServer(language: SupportedLspLanguage): LanguageServerInstance {
    const serverKey = LANGUAGE_TO_SERVER[language]
    if (!serverKey) {
      throw new Error(`[LanguageServerService] No server configured for ${language}`)
    }
    const existing = this.servers.get(serverKey)
    if (existing) return existing

    const instance = new LanguageServerInstance(
      this.workspaceRoot,
      serverKey,
      () => this.resolveLaunchConfig(serverKey, this.workspaceRoot),
      (params) => this.handleDiagnostics(params),
      (status, meta) => this.updateSnapshot(serverKey, status, meta)
    )
    this.servers.set(serverKey, instance)
    return instance
  }

  private findDocument(pathOrUri: string): DocumentState | undefined {
    if (!pathOrUri) return undefined
    const absolute = pathOrUri.startsWith('file:') ? URI.parse(pathOrUri).fsPath : pathOrUri
    const normalized = path.normalize(absolute)
    return this.documents.get(normalized)
  }

  private handleDiagnostics(params: PublishDiagnosticsParams): void {
    const uri = params.uri
    const doc = this.findDocument(uri)
    const pathFromUri = doc?.path ?? URI.parse(uri).fsPath
    
    if (params.diagnostics?.length > 0) {
      console.log(`[LanguageServerService] Received ${params.diagnostics.length} diagnostics for ${pathFromUri}`)
    }

    const payload: LspDiagnosticsEvent = {
      workspaceRoot: this.workspaceRoot,
      uri,
      path: pathFromUri,
      languageId: doc?.languageId,
      diagnostics: (params.diagnostics || []).map((diag) => ({
        message: diag.message,
        severity: diag.severity,
        source: diag.source,
        code: diag.code as any,
        startLine: diag.range.start.line,
        startCharacter: diag.range.start.character,
        endLine: diag.range.end.line,
        endCharacter: diag.range.end.character,
      })),
      updatedAt: Date.now(),
    }
    this.emitDiagnostics(payload)
  }

  async openDocument(params: LspDocumentParams): Promise<void> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) return
    const absolute = this.toAbsolutePath(params.path)
    const normalized = path.normalize(absolute)
    const uri = this.toDocumentUri(absolute)
    const server = this.ensureServer(lang)
    const existing = this.documents.get(normalized)

    if (existing) {
      existing.version = params.version
      existing.text = params.text
      await server.sendNotification(DidChangeTextDocumentNotification.method, {
        textDocument: { uri: existing.uri, version: existing.version },
        contentChanges: [{ text: params.text }],
      })
      return
    }

    const doc: DocumentState = {
      path: normalized,
      uri,
      languageId: lang,
      serverKey: LANGUAGE_TO_SERVER[lang]!,
      version: params.version,
      text: params.text,
    }
    this.documents.set(normalized, doc)
    await server.sendNotification(DidOpenTextDocumentNotification.method, {
      textDocument: {
        uri: doc.uri,
        languageId: doc.languageId,
        text: doc.text,
        version: doc.version,
      },
    })
  }

  async changeDocument(params: LspDocumentParams): Promise<void> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) return
    const absolute = this.toAbsolutePath(params.path)
    const normalized = path.normalize(absolute)
    const doc = this.documents.get(normalized)
    const server = this.ensureServer(lang)

    if (!doc) {
      await this.openDocument(params)
      return
    }

    doc.version = params.version
    doc.text = params.text
    await server.sendNotification(DidChangeTextDocumentNotification.method, {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: params.text }],
    })
  }

  async closeDocument(pathOrUri: string): Promise<void> {
    const doc = this.findDocument(pathOrUri)
    if (!doc) return
    const server = this.servers.get(doc.serverKey)
    this.documents.delete(doc.path)
    if (!server) return
    await server.sendNotification(DidCloseTextDocumentNotification.method, {
      textDocument: { uri: doc.uri },
    })
  }

  async requestCompletion(params: LspCompletionRequest): Promise<CompletionResultPayload> {
    const doc = this.findDocument(params.path)
    if (!doc) throw new Error('Document not opened for completion request')
    const server = this.servers.get(doc.serverKey)
    if (!server) throw new Error('Language server not ready')

    const completionParams: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: params.position.line, character: params.position.character },
      context: params.context
        ? {
            triggerKind: normalizeTriggerKind(params.context.triggerKind),
            triggerCharacter: params.context.triggerCharacter,
          }
        : undefined,
    }

    const items = await server.sendRequest<CompletionList | CompletionItem[] | null>(CompletionRequest.method, completionParams)
    return { items }
  }

  async requestHover(params: LspHoverRequest): Promise<Hover | null> {
    const doc = this.findDocument(params.path)
    if (!doc) return null
    const server = this.servers.get(doc.serverKey)
    if (!server) return null
    return server.sendRequest<Hover | null>(HoverRequest.method, {
      textDocument: { uri: doc.uri },
      position: { line: params.position.line, character: params.position.character },
    })
  }

  async requestDefinition(params: LspDefinitionRequest): Promise<Definition | null> {
    const doc = this.findDocument(params.path)
    if (!doc) return null
    const server = this.servers.get(doc.serverKey)
    if (!server) return null
    return server.sendRequest<Definition | null>(DefinitionRequest.method, {
      textDocument: { uri: doc.uri },
      position: { line: params.position.line, character: params.position.character },
    })
  }

  async dispose(): Promise<void> {
    for (const server of this.servers.values()) {
      await server.dispose()
    }
    this.servers.clear()
    this.documents.clear()
  }
}

export class LanguageServerService extends Service<LanguageServerState> {
  private readonly hosts = new Map<string, WorkspaceLanguageHost>()
  private readonly serverRuntime = new Map<ServerKey, ServerRuntimeSnapshot>()
  private readonly serverVersions = new Map<ServerKey, string | null>()
  private registryCache: Map<string, MasonPackageEntry> | null = null
  private registryFetchedAt = 0
  private registryPromise: Promise<void> | null = null
  private readonly relevantPackages = new Set<string>(LANGUAGE_SERVER_DEFINITIONS.map((def) => def.masonPackage))

  constructor() {
    super({
      workspaces: {},
      preferences: { autoInstall: false, enabledLanguages: {} },
    }, 'languageServers')

    this.applyDefaultLanguagePreferences()
    void this.ensureRegistry().catch((error) => {
      console.warn('[LanguageServerService] Failed to sync Mason registry:', error)
    })
    this.broadcastAllLanguageStatuses()
  }

  protected onStateChange(updates: Partial<LanguageServerState>, prevState: LanguageServerState): void {
    if (updates.preferences && updates.preferences !== prevState.preferences) {
      this.persistFields(['preferences'])
      this.broadcastAllLanguageStatuses()
    }
  }

  async prepareWorkspace(workspaceRoot: string): Promise<void> {
    this.createHost(workspaceRoot)
  }

  async resetWorkspace(workspaceRoot: string): Promise<void> {
    const normalized = normalizeWorkspaceRoot(workspaceRoot)
    const host = this.hosts.get(normalized)
    if (host) {
      await host.dispose()
      this.hosts.delete(normalized)
    }
    const nextState = { ...this.state.workspaces }
    delete nextState[normalized]
    this.setState({ workspaces: nextState })
  }

  async openDocument(workspaceRoot: string, params: LspDocumentParams): Promise<void> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) return
    this.ensureLanguageAccess(lang)
    const host = this.createHost(workspaceRoot)
    await host.openDocument({ ...params, languageId: lang })
  }

  async changeDocument(workspaceRoot: string, params: LspDocumentParams): Promise<void> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) return
    this.ensureLanguageAccess(lang)
    const host = this.createHost(workspaceRoot)
    await host.changeDocument({ ...params, languageId: lang })
  }

  async closeDocument(workspaceRoot: string, pathOrUri: string): Promise<void> {
    const host = this.hosts.get(normalizeWorkspaceRoot(workspaceRoot))
    if (!host) return
    await host.closeDocument(pathOrUri)
  }

  async requestCompletion(workspaceRoot: string, params: LspCompletionRequest): Promise<CompletionResultPayload> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) throw new Error('unsupported-language')
    this.ensureLanguageAccess(lang)
    const host = this.hosts.get(normalizeWorkspaceRoot(workspaceRoot))
    if (!host) throw new Error('Workspace not initialized for LSP')
    return host.requestCompletion(params)
  }

  async requestHover(workspaceRoot: string, params: LspHoverRequest): Promise<Hover | null> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) return null
    this.ensureLanguageAccess(lang)
    const host = this.hosts.get(normalizeWorkspaceRoot(workspaceRoot))
    if (!host) return null
    return host.requestHover(params)
  }

  async requestDefinition(workspaceRoot: string, params: LspDefinitionRequest): Promise<Definition | null> {
    const lang = normalizeLanguageId(params.languageId)
    if (!lang) return null
    this.ensureLanguageAccess(lang)
    const host = this.hosts.get(normalizeWorkspaceRoot(workspaceRoot))
    if (!host) return null
    return host.requestDefinition(params)
  }

  async listLanguageStatuses(): Promise<LspLanguageListResponse> {
    const languages: LspLanguageStatusPayload[] = []
    for (const def of LANGUAGE_SERVER_DEFINITIONS) {
      for (const languageId of def.languages) {
        const normalized = normalizeLanguageId(languageId)
        if (!normalized) continue
        languages.push(this.buildLanguageStatus(normalized))
      }
    }
    return {
      autoInstall: !!this.state.preferences.autoInstall,
      languages,
    }
  }

  async provisionLanguage(languageId: string): Promise<LspLanguageStatusPayload> {
    const normalized = normalizeLanguageId(languageId)
    if (!normalized) {
      throw Object.assign(new Error('unsupported-language'), { code: 'unsupported-language' })
    }
    const def = LANGUAGE_TO_SERVER[normalized]
    if (!def) {
      throw Object.assign(new Error('unsupported-language'), { code: 'unsupported-language' })
    }
    this.setLanguageEnabled(normalized, true)
    return this.buildLanguageStatus(normalized)
  }

  setAutoInstall(enabled: boolean): void {
    if (this.state.preferences.autoInstall === enabled) return
    this.setState({ preferences: { ...this.state.preferences, autoInstall: enabled } })
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private createHost(workspaceRoot: string): WorkspaceLanguageHost {
    const normalized = normalizeWorkspaceRoot(workspaceRoot)
    let host = this.hosts.get(normalized)
    if (host) return host

    const snapshot = this.ensureWorkspaceSnapshot(normalized)
    const updateSnapshot = (serverKey: ServerKey, status: ServerStatus, meta?: { error?: string | null }) => {
      const current = this.state.workspaces[normalized]?.servers || {}
      const next = {
        ...current,
        [serverKey]: {
          status,
          lastStartedAt: status === 'starting' ? Date.now() : current[serverKey]?.lastStartedAt,
          lastError: meta?.error ?? null,
        },
      }
      this.setState({ workspaces: { ...this.state.workspaces, [normalized]: { servers: next } } })
      this.updateServerRuntime(serverKey, status, meta)
    }

    const emitDiagnostics = (payload: LspDiagnosticsEvent) => {
      this.emit('lsp:diagnostics', payload)
    }

    host = new WorkspaceLanguageHost(
      normalized,
      emitDiagnostics,
      updateSnapshot,
      (serverKey, workspaceRoot) => this.resolveLaunchConfig(serverKey, workspaceRoot)
    )
    this.hosts.set(normalized, host)
    this.setState({ workspaces: { ...this.state.workspaces, [normalized]: snapshot } })
    return host
  }

  private ensureWorkspaceSnapshot(workspaceRoot: string): WorkspaceServerSnapshot {
    const existing = this.state.workspaces[workspaceRoot]
    if (existing) return existing
    return { servers: {} }
  }

  private applyDefaultLanguagePreferences(): void {
    const defaults = { ...this.state.preferences.enabledLanguages }
    for (const def of LANGUAGE_SERVER_DEFINITIONS) {
      const shouldEnable = def.provisioning.type === 'builtin'
      for (const lang of def.languages) {
        const normalized = normalizeLanguageId(lang)
        if (!normalized) continue
        if (typeof defaults[normalized] === 'undefined') {
          defaults[normalized] = shouldEnable
        }
      }
    }
    this.setState({ preferences: { ...this.state.preferences, enabledLanguages: defaults } })
  }

  private isLanguageEnabled(languageId: SupportedLspLanguage): boolean {
    const enabled = this.state.preferences.enabledLanguages?.[languageId]
    return typeof enabled === 'boolean' ? enabled : false
  }

  private setLanguageEnabled(languageId: SupportedLspLanguage, enabled: boolean): void {
    if (this.isLanguageEnabled(languageId) === enabled) return
    const next = { ...this.state.preferences.enabledLanguages, [languageId]: enabled }
    this.setState({ preferences: { ...this.state.preferences, enabledLanguages: next } })
    this.emitLanguageStatus(languageId)
  }

  private ensureLanguageAccess(languageId: SupportedLspLanguage): void {
    const serverKey = LANGUAGE_TO_SERVER[languageId]
    if (!serverKey) return
    if (this.isLanguageEnabled(languageId)) return
    const definition = SERVER_DEFINITION_BY_KEY.get(serverKey)
    const autoInstallable = definition?.provisioning.type === 'npm-npx'
    if (autoInstallable && this.state.preferences.autoInstall) {
      this.setLanguageEnabled(languageId, true)
      return
    }
    throw Object.assign(new Error('language-disabled'), { code: 'language-disabled', languageId })
  }

  private buildLanguageStatus(languageId: SupportedLspLanguage): LspLanguageStatusPayload {
    const serverKey = LANGUAGE_TO_SERVER[languageId]
    const definition = serverKey ? SERVER_DEFINITION_BY_KEY.get(serverKey) : null
    if (!definition || !serverKey) {
      return {
        languageId,
        serverKey: 'unknown',
        displayName: languageId,
        status: 'unsupported',
        autoInstallable: false,
        updatedAt: Date.now(),
      }
    }

    const runtime = this.serverRuntime.get(serverKey)
    const enabled = this.isLanguageEnabled(languageId)
    let status: LspLanguageStatusPayload['status'] = 'pending'
    if (!enabled) {
      status = 'disabled'
    } else if (!runtime || runtime.status === 'idle' || runtime.status === 'stopped') {
      status = 'pending'
    } else if (runtime.status === 'starting') {
      status = 'installing'
    } else if (runtime.status === 'ready') {
      status = 'ready'
    } else if (runtime.status === 'error') {
      status = 'error'
    }

    return {
      languageId,
      serverKey,
      displayName: definition.displayName,
      status,
      autoInstallable: definition.provisioning.type === 'npm-npx',
      masonPackage: definition.masonPackage,
      version: this.serverVersions.get(serverKey) ?? undefined,
      lastError: runtime?.lastError ?? null,
      updatedAt: Date.now(),
    }
  }

  private emitLanguageStatus(languageId: SupportedLspLanguage): void {
    const payload = this.buildLanguageStatus(languageId)
    this.emit('lsp:languageStatus', payload)
  }

  private broadcastAllLanguageStatuses(): void {
    for (const def of LANGUAGE_SERVER_DEFINITIONS) {
      for (const lang of def.languages) {
        const normalized = normalizeLanguageId(lang)
        if (normalized) this.emitLanguageStatus(normalized)
      }
    }
  }

  private broadcastServerLanguages(serverKey: ServerKey): void {
    const definition = SERVER_DEFINITION_BY_KEY.get(serverKey)
    if (!definition) return
    for (const lang of definition.languages) {
      const normalized = normalizeLanguageId(lang)
      if (normalized) this.emitLanguageStatus(normalized)
    }
  }

  private updateServerRuntime(serverKey: ServerKey, status: ServerStatus, meta?: { error?: string | null }): void {
    this.serverRuntime.set(serverKey, { status, lastError: meta?.error ?? null })
    this.broadcastServerLanguages(serverKey)
  }

  private async resolveLaunchConfig(serverKey: ServerKey, workspaceRoot: string): Promise<LaunchConfig> {
    console.log(`[LanguageServerService] Resolving launch config for ${serverKey} in ${workspaceRoot}`)
    const definition = SERVER_DEFINITION_BY_KEY.get(serverKey)
    if (!definition) {
      throw new Error(`[LanguageServerService] Unknown server key ${serverKey}`)
    }

    const { command, env } = resolveNodeCommandEnv(workspaceRoot)

    // Strategy 1: Look for the package in the workspace or app node_modules
    const localBin = resolvePackageBin(workspaceRoot, definition.masonPackage)
    if (localBin) {
      console.log(`[LanguageServerService] Found local bin for ${serverKey}: ${localBin}`)
      const initializationOptions: any = {}
      const args = [localBin, '--stdio']

      if (serverKey === 'tsserver') {
        const tsserverPath = resolveTsserverPath(workspaceRoot)
        if (tsserverPath) {
          const tsdk = path.dirname(tsserverPath)
          initializationOptions.tsserver = { path: tsserverPath }
          initializationOptions.typescript = { tsdk }
          
          // Add command line flags for redundancy/reliability
          args.push('--tsserver-path', tsserverPath)
          args.push('--tsdk', tsdk)
          
          console.log(`[LanguageServerService] Injected tsserver initialization options and args`, {
            initializationOptions,
            extraArgs: ['--tsserver-path', tsserverPath, '--tsdk', tsdk]
          })
        }
      }
      return { command, env, args, initializationOptions }
    }

    // Strategy 2: Fallback to npm-npx for non-builtin servers
    console.log(`[LanguageServerService] No local bin found for ${serverKey}, falling back to npx`)
    if (definition.provisioning.type === 'npm-npx') {
      const version = await this.resolveMasonVersion(definition.masonPackage)
      if (version) {
        this.serverVersions.set(serverKey, version)
      }
      const packageSpecifier = version ? `${definition.masonPackage}@${version}` : definition.masonPackage
      const args = ['--yes', packageSpecifier, definition.provisioning.bin, ...(definition.provisioning.args ?? [])]
      console.log(`[LanguageServerService] npx launch args for ${serverKey}:`, args)
      return { command: getNpxCommand(), args, env }
    }

    throw new Error(`[LanguageServerService] Unsupported provisioning for ${serverKey}`)
  }

  private async resolveMasonVersion(packageName: string): Promise<string | null> {
    const pkg = await this.getMasonPackage(packageName)
    const id = pkg?.source?.id
    if (!id) return null
    const match = /pkg:npm\/[^@]+@([^\s]+)/.exec(id)
    return match?.[1] ?? null
  }

  private async getMasonPackage(packageName: string): Promise<MasonPackageEntry | null> {
    await this.ensureRegistry()
    return this.registryCache?.get(packageName) ?? null
  }

  private async ensureRegistry(force = false): Promise<void> {
    if (!force && this.registryCache && Date.now() - this.registryFetchedAt < 1000 * 60 * 60 * 6) {
      return
    }
    if (this.registryPromise) {
      await this.registryPromise
      return
    }
    this.registryPromise = this.refreshRegistry()
    try {
      await this.registryPromise
    } finally {
      this.registryPromise = null
    }
  }

  private async refreshRegistry(): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'hifide-app',
        Accept: 'application/vnd.github+json',
      }
      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
      }
      const releaseRes = await fetch('https://api.github.com/repos/mason-org/mason-registry/releases/latest', { headers })
      if (!releaseRes.ok) throw new Error(`Release fetch failed: ${releaseRes.status}`)
      const release = await releaseRes.json() as any
      const asset = Array.isArray(release?.assets) ? release.assets.find((it: any) => it?.name === 'registry.json.zip') : null
      if (!asset?.browser_download_url) {
        throw new Error('registry.json.zip asset missing')
      }
      const assetHeaders = { ...headers, Accept: 'application/octet-stream' }
      const registryRes = await fetch(asset.browser_download_url, { headers: assetHeaders })
      if (!registryRes.ok) throw new Error(`Registry download failed: ${registryRes.status}`)
      const buffer = Buffer.from(await registryRes.arrayBuffer())
      const files = unzipSync(buffer)
      const registryBuffer = files['registry.json']
      if (!registryBuffer) throw new Error('registry.json missing in archive')
      const parsed = JSON.parse(Buffer.from(registryBuffer).toString('utf8')) as MasonPackageEntry[]
      const filtered = parsed.filter((pkg) => this.relevantPackages.has(pkg.name))
      this.registryCache = new Map(filtered.map((pkg) => [pkg.name, pkg]))
      this.registryFetchedAt = Date.now()
    } catch (error) {
      console.warn('[LanguageServerService] Mason registry refresh failed:', error)
      if (!this.registryCache) {
        this.registryCache = new Map()
      }
    }
  }
}
