import path from 'node:path'
import { 
  type PublishDiagnosticsParams,
  type CompletionParams,
  type HoverParams,
  type DefinitionParams,
  type ReferenceParams,
  type RenameParams,
  type CodeActionParams,
  type DocumentFormattingParams,
  type DocumentSymbolParams,
  type CompletionList,
  type CompletionItem,
  type Hover,
  type Definition,
  type Location,
  type CodeAction,
  type Command,
  type SymbolInformation,
  type DocumentSymbol,
  type WorkspaceEdit,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  CompletionRequest,
  HoverRequest,
  DefinitionRequest,
  ReferencesRequest,
  RenameRequest,
  CodeActionRequest,
  DocumentFormattingRequest,
  DocumentSymbolRequest,
} from 'vscode-languageserver-protocol'
import { LspClient } from './LspClient.js'
import { ProjectContext } from './ProjectContext.js'
import { 
  type ServerStatus, 
  toLspUri, 
  normalizePath, 
  normalizeTriggerKind 
} from './Protocol.js'
import { LANGUAGE_SERVER_DEFINITIONS, type LanguageServerDefinition } from '../../config/languageServers.js'
import { type SupportedLspLanguage, isLspLanguage } from '../../../shared/lsp.js'

export interface LspManagerOptions {
  workspaceRoot: string
  onDiagnostics: (params: PublishDiagnosticsParams) => void
  onStatusChange: (serverKey: string, status: ServerStatus, error?: string | null) => void
}

export class LspManager {
  private clients = new Map<string, LspClient>()
  private projectContext: ProjectContext
  private languageToClientKey = new Map<SupportedLspLanguage, string>()
  private definitions = new Map<string, LanguageServerDefinition>()

  constructor(private options: LspManagerOptions) {
    this.projectContext = new ProjectContext(options.workspaceRoot)
    for (const def of LANGUAGE_SERVER_DEFINITIONS) {
      this.definitions.set(def.key, def)
      for (const lang of def.languages) {
        this.languageToClientKey.set(lang, def.key)
      }
    }
  }

  private async getClientForLanguage(languageId: SupportedLspLanguage): Promise<LspClient | null> {
    const serverKey = this.languageToClientKey.get(languageId)
    if (!serverKey) return null

    let client = this.clients.get(serverKey)
    if (client) return client

    const definition = this.definitions.get(serverKey)!
    const launchConfig = await this.resolveLaunchConfig(definition)
    
    client = new LspClient({
      workspaceRoot: this.options.workspaceRoot,
      serverKey,
      launchConfig,
      onDiagnostics: (params) => this.options.onDiagnostics(params),
      onStatusChange: (status, error) => this.options.onStatusChange(serverKey, status, error)
    })

    this.clients.set(serverKey, client)
    return client
  }

  private async resolveLaunchConfig(definition: LanguageServerDefinition) {
    const env = this.projectContext.getLaunchEnv()
    
    if (definition.key === 'tsserver') {
      const vtslsPath = this.projectContext.resolvePackageBin('@vtsls/language-server', 'vtsls')
      const tsserverPath = this.projectContext.resolveTsserverPath()
      const tsdk = tsserverPath ? path.dirname(tsserverPath) : undefined

      return {
        command: process.execPath,
        args: [vtslsPath!, '--stdio'],
        env,
        initializationOptions: {
          typescript: {
            tsdk: tsdk,
          },
          vtsls: {
            autoUseWorkspaceTsdk: true,
          }
        },
        settings: {
          typescript: {
            tsdk: tsdk,
            suggest: {
              completeFunctionCalls: true
            },
            inlayHints: {
              parameterNames: { enabled: 'all' },
              variableTypes: { enabled: true }
            }
          },
          javascript: {
            format: {
              semicolons: 'insert'
            }
          }
        }
      }
    }

    if (definition.provisioning.type === 'npm-npx') {
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      return {
        command: npx,
        args: ['--yes', '--package', definition.masonPackage, '--', definition.provisioning.bin, ...(definition.provisioning.args || [])],
        env
      }
    }

    throw new Error(`Unsupported provisioning for ${definition.key}`)
  }

  async didOpen(params: { path: string; languageId: string; text: string; version: number }) {
    const lang = params.languageId as SupportedLspLanguage
    if (!isLspLanguage(lang)) return
    const client = await this.getClientForLanguage(lang)
    if (!client) return

    client.sendNotification(DidOpenTextDocumentNotification.method, {
      textDocument: {
        uri: toLspUri(params.path),
        languageId: lang,
        version: params.version,
        text: params.text
      }
    })
  }

  async didChange(params: { path: string; text: string; version: number }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return

    client.sendNotification(DidChangeTextDocumentNotification.method, {
      textDocument: { uri: toLspUri(params.path), version: params.version },
      contentChanges: [{ text: params.text }]
    })
  }

  async didClose(params: { path: string }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return

    client.sendNotification(DidCloseTextDocumentNotification.method, {
      textDocument: { uri: toLspUri(params.path) }
    })
  }

  async getCompletions(params: { path: string; line: number; character: number; triggerKind?: number; triggerCharacter?: string }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null

    return client.sendRequest<CompletionList | CompletionItem[] | null>(CompletionRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      position: { line: params.line, character: params.character },
      context: {
        triggerKind: normalizeTriggerKind(params.triggerKind),
        triggerCharacter: params.triggerCharacter
      }
    })
  }

  async getHover(params: { path: string; line: number; character: number }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<Hover | null>(HoverRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      position: { line: params.line, character: params.character }
    })
  }

  async getDefinition(params: { path: string; line: number; character: number }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<Definition | null>(DefinitionRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      position: { line: params.line, character: params.character }
    })
  }

  async getReferences(params: { path: string; line: number; character: number }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<Location[] | null>(ReferencesRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      position: { line: params.line, character: params.character },
      context: { includeDeclaration: true }
    })
  }

  async getDocumentSymbols(params: { path: string }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<SymbolInformation[] | DocumentSymbol[] | null>(DocumentSymbolRequest.method, {
      textDocument: { uri: toLspUri(params.path) }
    })
  }

  async rename(params: { path: string; line: number; character: number; newName: string }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<WorkspaceEdit | null>(RenameRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      position: { line: params.line, character: params.character },
      newName: params.newName
    })
  }

  async getCodeActions(params: { path: string; range: any; context: any }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<(Command | CodeAction)[] | null>(CodeActionRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      range: params.range,
      context: params.context
    })
  }

  async formatDocument(params: { path: string; options: any }) {
    const client = await this.getClientForPath(params.path)
    if (!client) return null
    return client.sendRequest<WorkspaceEdit | null>(DocumentFormattingRequest.method, {
      textDocument: { uri: toLspUri(params.path) },
      options: params.options
    })
  }

  private async getClientForPath(filePath: string): Promise<LspClient | null> {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const langMap: Record<string, SupportedLspLanguage> = {
      'ts': 'typescript',
      'mts': 'typescript',
      'cts': 'typescript',
      'tsx': 'typescriptreact',
      'js': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'jsx': 'javascriptreact',
      'py': 'python',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml'
    }
    const lang = langMap[ext]
    if (!lang) return null
    return this.getClientForLanguage(lang)
  }

  async dispose() {
    for (const client of this.clients.values()) {
      await client.dispose()
    }
    this.clients.clear()
  }
}
