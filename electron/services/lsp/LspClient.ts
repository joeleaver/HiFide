import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { 
  MessageConnection, 
  StreamMessageReader, 
  StreamMessageWriter, 
  createMessageConnection 
} from 'vscode-jsonrpc/node.js'
import {
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  PublishDiagnosticsNotification,
  type InitializeResult,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol'
import path from 'node:path'
import { type ServerStatus, toLspUri, normalizePath } from './Protocol.js'
import { type LaunchConfig } from './ProjectContext.js'

export interface LspClientOptions {
  workspaceRoot: string
  serverKey: string
  launchConfig: LaunchConfig
  onDiagnostics: (params: PublishDiagnosticsParams) => void
  onStatusChange: (status: ServerStatus, error?: string | null) => void
}

export class LspClient {
  private connection: MessageConnection | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private status: ServerStatus = 'idle'
  private readyPromise: Promise<void> | null = null
  private disposed = false

  constructor(private options: LspClientOptions) {}

  async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error('LspClient disposed')
    if (this.status === 'ready') return
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = this.start()
    return this.readyPromise
  }

  private async start(): Promise<void> {
    this.updateStatus('starting')
    const { launchConfig, workspaceRoot, serverKey } = this.options

    try {
      const cwd = normalizePath(workspaceRoot)
      this.child = spawn(launchConfig.command, launchConfig.args, {
        cwd,
        env: { ...process.env, ...(launchConfig.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      })

      this.child.stderr.on('data', (chunk) => {
        console.error(`[LSP:${serverKey}] stderr: ${chunk.toString().trim()}`)
      })

      this.child.on('exit', (code, signal) => {
        console.log(`[LSP:${serverKey}] exited with code ${code} signal ${signal}`)
        this.updateStatus('stopped', code || signal ? `Exit ${code} ${signal}` : null)
        this.dispose()
      })

      const reader = new StreamMessageReader(this.child.stdout)
      const writer = new StreamMessageWriter(this.child.stdin)
      this.connection = createMessageConnection(reader, writer)

      this.connection.onNotification(PublishDiagnosticsNotification.method, (params: PublishDiagnosticsParams) => {
        this.options.onDiagnostics(params)
      })

      this.connection.listen()

      const rootUri = toLspUri(workspaceRoot)
      const initializeParams = {
        processId: process.pid,
        rootPath: workspaceRoot.replace(/\\/g, '/'),
        rootUri,
        capabilities: {
          textDocument: {
            synchronization: { didSave: true, dynamicRegistration: true },
            completion: { completionItem: { documentationFormat: ['markdown', 'plaintext'], snippetSupport: true } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { dynamicRegistration: true },
            references: { dynamicRegistration: true },
            documentSymbol: { dynamicRegistration: true },
            codeAction: { dynamicRegistration: true },
            formatting: { dynamicRegistration: true },
            rename: { dynamicRegistration: true },
          },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: { dynamicRegistration: true },
            workspaceFolders: true,
          },
        },
        workspaceFolders: [{ name: path.basename(workspaceRoot), uri: rootUri }],
        initializationOptions: launchConfig.initializationOptions,
      }

      const result = await this.connection.sendRequest<InitializeResult>(InitializeRequest.method, initializeParams)
      console.log(`[LSP:${serverKey}] Initialized`, result.capabilities)
      
      this.connection.sendNotification(InitializedNotification.method, {})

      if (launchConfig.settings) {
        this.connection.sendNotification('workspace/didChangeConfiguration', {
          settings: launchConfig.settings
        })
      }

      this.updateStatus('ready')
    } catch (err: any) {
      this.updateStatus('error', err.message)
      throw err
    }
  }

  private updateStatus(status: ServerStatus, error: string | null = null) {
    this.status = status
    this.options.onStatusChange(status, error)
  }

  async sendRequest<T>(method: string, params: any): Promise<T> {
    await this.ensureReady()
    if (!this.connection) throw new Error('No connection')
    return this.connection.sendRequest<T>(method, params)
  }

  async sendNotification(method: string, params: any): Promise<void> {
    await this.ensureReady()
    if (!this.connection) throw new Error('No connection')
    this.connection.sendNotification(method, params)
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.status = 'stopped'
    
    if (this.connection) {
      try {
        await this.connection.sendRequest(ShutdownRequest.method)
        this.connection.sendNotification(ExitNotification.method)
      } catch {}
      this.connection.dispose()
    }
    
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
  }
}
