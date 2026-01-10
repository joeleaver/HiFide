/**
 * GlobalIndexingOrchestrator
 *
 * Main process service that manages:
 * - Global worker pool (sized by settings)
 * - Global priority queue across all workspaces
 * - Round-robin scheduling between open workspaces
 * - Workspace lifecycle management
 *
 * This replaces the old IndexOrchestrator with proper workspace isolation.
 */

import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { app } from 'electron'
import { Service } from '../base/Service.js'
import { PriorityIndexingQueue } from './PriorityIndexingQueue.js'
import { WorkspaceIndexingManager, WorkspaceIndexingState } from './WorkspaceIndexingManager.js'
import { getVectorService, getSettingsService } from '../index.js'

// Configuration constants
const DEFAULT_MAX_WORKERS = 4
const WORKER_REQUEST_TIMEOUT_MS = 30000
const QUEUE_PROCESS_DEBOUNCE_MS = 10
const REINDEX_SETTLE_DELAY_MS = 500

interface GlobalOrchestratorState {
  status: 'idle' | 'indexing' | 'paused'
  activeWorkers: number
  totalQueueLength: number
  failedItems: number
}

export class GlobalIndexingOrchestrator extends Service<GlobalOrchestratorState> {
  private workers: Worker[] = []
  private maxWorkers = DEFAULT_MAX_WORKERS
  private workerRequestMap = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>()
  private reqId = 0

  private priorityQueue = new PriorityIndexingQueue()
  private workspaceManagers = new Map<string, WorkspaceIndexingManager>()
  private activeWorkers = 0
  private failedItemsCount = 0
  private processingTimer: NodeJS.Timeout | null = null
  private isShuttingDown = false

  constructor() {
    super(
      {
        status: 'idle',
        activeWorkers: 0,
        totalQueueLength: 0,
        failedItems: 0
      },
      'global_indexing_orchestrator'
    )

    this.loadSettings()
    this.setupGracefulShutdown()
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return
      this.isShuttingDown = true
      console.log('[GlobalIndexingOrchestrator] Graceful shutdown initiated...')
      await this.terminate()
    }

    app.on('before-quit', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  }

  protected onStateChange(_updates: Partial<GlobalOrchestratorState>): void {
    // No persistence needed
  }

  /**
   * Load settings (worker count, etc.)
   */
  private loadSettings(): void {
    try {
      const settingsService = getSettingsService()
      const vectorSettings = settingsService.getState().vector
      const indexingWorkers = vectorSettings?.indexingWorkers
      if (indexingWorkers !== undefined && indexingWorkers > 0) {
        this.maxWorkers = indexingWorkers
        console.log(`[GlobalIndexingOrchestrator] Loaded settings: maxWorkers = ${this.maxWorkers}`)
      }
    } catch (err) {
      console.warn('[GlobalIndexingOrchestrator] Failed to load settings, using defaults:', err)
    }
  }

  /**
   * Initialize worker pool
   */
  async init(): Promise<void> {
    // Terminate existing workers
    if (this.workers.length > 0) {
      console.log(`[GlobalIndexingOrchestrator] Terminating ${this.workers.length} existing workers...`)
      const terminatePromises = this.workers.map(worker =>
        worker.terminate().catch(err => console.warn('[GlobalIndexingOrchestrator] Failed to terminate worker:', err))
      )
      await Promise.all(terminatePromises)
      this.workers = []
    }

    // Initialize new workers
    const workerPath = this.getWorkerPath()
    console.log(`[GlobalIndexingOrchestrator] Initializing ${this.maxWorkers} parser workers...`)

    let execArgv: string[] | undefined = undefined
    if (workerPath.endsWith('.ts')) {
      const tsNodePath = path.join(process.cwd(), 'node_modules', 'ts-node', 'register.js')
      execArgv = ['-r', tsNodePath]
    }

    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(workerPath, { execArgv })
      const workerId = i

      worker.on('message', msg => {
        if (msg.type === 'result') {
          const req = this.workerRequestMap.get(msg.id)
          if (req) {
            this.workerRequestMap.delete(msg.id)
            req.resolve(msg.result)
          }
        }
      })

      worker.on('error', err => {
        console.error(`[GlobalIndexingOrchestrator] Worker ${workerId} error:`, err)
        // Reject all pending requests for this worker
        // Note: We can't easily track which requests went to which worker,
        // so we just log the error and let the timeout handle cleanup
      })

      worker.on('exit', code => {
        if (code !== 0 && !this.isShuttingDown) {
          console.error(`[GlobalIndexingOrchestrator] Worker ${workerId} exited with code ${code}`)
        }
      })

      this.workers.push(worker)
    }
  }

  /**
   * Terminate all workers
   */
  async terminate(): Promise<void> {
    console.log('[GlobalIndexingOrchestrator] Terminating all workers...')
    this.isShuttingDown = true

    if (this.processingTimer) {
      clearTimeout(this.processingTimer)
      this.processingTimer = null
    }

    // Reject all pending requests
    for (const [reqId, handler] of this.workerRequestMap.entries()) {
      handler.reject(new Error('Worker terminated during shutdown'))
      this.workerRequestMap.delete(reqId)
    }

    // Clean up all workspace managers
    for (const [workspaceId, manager] of this.workspaceManagers.entries()) {
      try {
        await manager.cleanup()
      } catch (err) {
        console.warn(`[GlobalIndexingOrchestrator] Failed to cleanup manager for ${workspaceId}:`, err)
      }
    }
    this.workspaceManagers.clear()

    // Terminate workers
    const terminatePromises = this.workers.map(worker =>
      worker.terminate().catch(err => console.warn('[GlobalIndexingOrchestrator] Failed to terminate worker:', err))
    )
    await Promise.all(terminatePromises)
    this.workers = []
    this.activeWorkers = 0

    // Clear the queue
    this.priorityQueue.clear()

    console.log('[GlobalIndexingOrchestrator] Shutdown complete')
  }

  /**
   * Register a workspace
   */
  async registerWorkspace(workspaceId: string): Promise<void> {
    const normalized = path.resolve(workspaceId)
    console.log(`[GlobalIndexingOrchestrator] Registering workspace: ${normalized}`)

    if (!this.workspaceManagers.has(normalized)) {
      const manager = new WorkspaceIndexingManager(normalized)
      this.workspaceManagers.set(normalized, manager)

      // Listen to file events from the watcher
      manager.on('file-events', (events: any[]) => {
        this.onWorkspaceFileEvents(normalized, events)
      })

      // Listen to state changes
      manager.on('state-changed', () => {
        this.emit('workspace-state-changed', { workspaceId: normalized, state: manager.getState() })
      })
    }

    if (this.workers.length === 0) {
      await this.init()
    }
  }

  /**
   * Unregister a workspace
   */
  async unregisterWorkspace(workspaceId: string): Promise<void> {
    const normalized = path.resolve(workspaceId)
    console.log(`[GlobalIndexingOrchestrator] Unregistering workspace: ${normalized}`)

    const manager = this.workspaceManagers.get(normalized)
    if (manager) {
      await manager.cleanup()
      this.workspaceManagers.delete(normalized)
      this.priorityQueue.clearWorkspace(normalized)
    }
  }

  /**
   * Get list of open workspaces
   */
  getOpenWorkspaces(): string[] {
    return Array.from(this.workspaceManagers.keys())
  }

  /**
   * Get workspace manager
   */
  getWorkspaceManager(workspaceId: string): WorkspaceIndexingManager | undefined {
    const normalized = path.resolve(workspaceId)
    return this.workspaceManagers.get(normalized)
  }

  /**
   * Get status for a workspace
   */
  getStatus(workspaceId: string): WorkspaceIndexingState | null {
    const manager = this.getWorkspaceManager(workspaceId)
    return manager ? manager.getState() : null
  }

  /**
   * Get global status
   */
  getGlobalStatus() {
    return {
      activeWorkers: this.activeWorkers,
      queueLength: this.priorityQueue.getQueueLength(),
      openWorkspaces: this.getOpenWorkspaces().length,
      status: this.state.status
    }
  }

  /**
   * Called when a workspace receives file events from the watcher
   */
  private onWorkspaceFileEvents(workspaceId: string, events: any[]): void {
    console.log(`[GlobalIndexingOrchestrator] Received ${events.length} file events from workspace ${workspaceId}`)

    if (events.length === 0) return

    // Push events to global priority queue as code indexing tasks
    this.priorityQueue.push(workspaceId, events, 'code')

    // Trigger processing
    this.processQueue()
  }

  /**
   * Process the global queue
   */
  private processQueue(): void {
    if (this.isShuttingDown) return

    if (this.processingTimer) {
      clearTimeout(this.processingTimer)
    }

    this.processingTimer = setTimeout(() => {
      this.doProcessQueue()
    }, QUEUE_PROCESS_DEBOUNCE_MS)
  }

  /**
   * Actually process queue items
   */
  private doProcessQueue(): void {
    if (this.isShuttingDown) return

    while (this.activeWorkers < this.maxWorkers && this.priorityQueue.getQueueLength() > 0) {
      const items = this.priorityQueue.pop(1)
      if (items.length === 0) break

      const item = items[0]
      this.activeWorkers++
      this.setState({ activeWorkers: this.activeWorkers })

      this.processItem(item).finally(() => {
        this.activeWorkers--
        this.setState({ activeWorkers: this.activeWorkers, failedItems: this.failedItemsCount })
        if (!this.isShuttingDown) {
          this.doProcessQueue()
        }
      })
    }

    this.setState({ totalQueueLength: this.priorityQueue.getQueueLength() })
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: any): Promise<void> {
    const manager = this.getWorkspaceManager(item.workspaceId)
    if (!manager) return

    const state = manager.getState()
    console.log(
      `[GlobalIndexingOrchestrator] Processing ${item.type} item: ${item.path} from ${item.workspaceId}`
    )

    try {
      // Send file to worker for parsing
      const result = await this.sendToWorker({
        type: 'parse',
        filePath: item.path,
        workspaceRoot: item.workspaceId
      })

      if (result && result.chunks && result.chunks.length > 0) {
        // Upsert chunks to vector database
        const vectorService = getVectorService()
        if (vectorService) {
          await vectorService.upsertItems(item.workspaceId, result.chunks, item.type || 'code')
          console.log(
            `[GlobalIndexingOrchestrator] Indexed ${result.chunks.length} chunks from ${item.path}`
          )

          // Update manager state - decrement missing, increment indexed
          manager.updateState({
            code: {
              ...state.code,
              indexed: state.code.indexed + 1,
              missing: Math.max(0, state.code.missing - 1)
            }
          })
        }
      } else if (result && result.skipped) {
        // File was skipped (e.g., too large) - decrement missing without incrementing indexed
        manager.updateState({
          code: {
            ...state.code,
            missing: Math.max(0, state.code.missing - 1)
          }
        })
      }
    } catch (error) {
      console.error(`[GlobalIndexingOrchestrator] Failed to process item ${item.path}:`, error)
      this.failedItemsCount++
      // Update manager state to reflect the failure
      manager.updateState({
        code: {
          ...state.code,
          missing: Math.max(0, state.code.missing - 1),
          stale: state.code.stale + 1
        }
      })
    }
  }

  /**
   * Send a message to an available worker
   */
  private sendToWorker(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.workers.length === 0) {
        reject(new Error('No workers available'))
        return
      }

      const reqId = ++this.reqId
      const worker = this.workers[reqId % this.workers.length]

      this.workerRequestMap.set(reqId, { resolve, reject })

      worker.postMessage({ ...message, id: reqId })

      // Timeout after configured duration
      setTimeout(() => {
        if (this.workerRequestMap.has(reqId)) {
          this.workerRequestMap.delete(reqId)
          reject(new Error(`Worker request timeout after ${WORKER_REQUEST_TIMEOUT_MS}ms`))
        }
      }, WORKER_REQUEST_TIMEOUT_MS)
    })
  }

  /**
   * Start indexing for a workspace
   */
  async start(workspaceId: string): Promise<void> {
    const manager = this.getWorkspaceManager(workspaceId)
    if (!manager) {
      console.warn(`[GlobalIndexingOrchestrator] Workspace not registered: ${workspaceId}`)
      return
    }

    manager.setStatus('indexing')
    await manager.startWatcher()
    this.processQueue()
  }

  /**
   * Stop indexing for a workspace
   */
  async stop(workspaceId: string): Promise<void> {
    const manager = this.getWorkspaceManager(workspaceId)
    if (!manager) return

    manager.setStatus('paused')
    await manager.stopWatcher()
  }

  /**
   * Re-index a workspace
   */
  async indexAll(workspaceId: string, force: boolean = false): Promise<void> {
    const manager = this.getWorkspaceManager(workspaceId)
    if (!manager) {
      console.warn(`[GlobalIndexingOrchestrator] Workspace not registered: ${workspaceId}`)
      return
    }

    this.loadSettings()
    await this.stop(workspaceId)
    await new Promise(resolve => setTimeout(resolve, REINDEX_SETTLE_DELAY_MS))

    // Reset failed items count on reindex
    this.failedItemsCount = 0
    this.setState({ failedItems: 0 })

    // Only reinitialize workers if none exist (don't affect other workspaces)
    if (this.workers.length === 0) {
      await this.init()
    }

    manager.updateState({
      totalFilesDiscovered: 0,
      indexedCount: 0,
      ...(force && {
        code: { total: 0, indexed: 0, missing: 0, stale: 0 },
        kb: { total: 0, indexed: 0, missing: 0, stale: 0 },
        memories: { total: 0, indexed: 0, missing: 0, stale: 0 }
      })
    })

    const options = force ? { ignoreInitial: false } : { ignoreInitial: true }
    await manager.startWatcher(options)
    manager.setStatus('indexing')
    this.processQueue()
  }

  /**
   * Set indexing enabled state
   */
  setIndexingEnabled(workspaceId: string, enabled: boolean): void {
    const manager = this.getWorkspaceManager(workspaceId)
    if (manager) {
      manager.setIndexingEnabled(enabled)
    }
  }

  /**
   * Run startup check for a workspace
   * Compares files on disk with indexed files and queues missing ones
   */
  async runStartupCheck(workspaceId: string): Promise<void> {
    const manager = this.getWorkspaceManager(workspaceId)
    if (!manager) return

    const state = manager.getState()
    if (!state.indexingEnabled) {
      manager.setStatus('idle')
      return
    }

    console.log(`[GlobalIndexingOrchestrator] Running startup check for ${workspaceId}`)

    try {
      const vectorService = getVectorService()
      if (!vectorService) {
        console.warn('[GlobalIndexingOrchestrator] VectorService not available for startup check')
        return
      }

      // Get already indexed file paths from the vector database
      const indexedPaths = await vectorService.getIndexedFilePaths(workspaceId, 'code')
      console.log(`[GlobalIndexingOrchestrator] Found ${indexedPaths.size} already indexed files`)

      // Start the watcher to discover current files
      // The watcher will emit events for files not in indexedPaths
      manager.setStatus('indexing')
      await manager.startWatcher({ ignoreInitial: false })

      // Update state to reflect we're checking
      manager.updateState({
        code: {
          ...state.code,
          indexed: indexedPaths.size
        }
      })

      this.processQueue()
    } catch (error) {
      console.error(`[GlobalIndexingOrchestrator] Startup check failed for ${workspaceId}:`, error)
      manager.setStatus('idle')
    }
  }

  /**
   * Get worker path
   */
  private getWorkerPath(): string {
    let baseDir = ''
    try {
      baseDir = path.dirname(fileURLToPath(import.meta.url))
    } catch {
      baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
    }

    const appPath = app.getAppPath()
    const candidates = [
      // ASAR unpacked (production) - use app.getAppPath() for correct resolution
      path.join(appPath, 'dist-electron/workers/indexing/v2-parser-worker.mjs'),
      // Vite build (Dev & Prod)
      path.join(process.cwd(), 'dist-electron/workers/indexing/v2-parser-worker.mjs'),
      // compiled relative to services/indexing/
      path.join(baseDir, '../../workers/indexing/v2-parser-worker.js'),
      // dev (ts-node)
      path.join(baseDir, '../../workers/indexing/v2-parser-worker.ts'),
      // prod bundle (legacy)
      path.join(process.cwd(), 'dist-electron/workers/indexing/v2-parser-worker.js'),
      // dev source
      path.join(process.cwd(), 'electron/workers/indexing/v2-parser-worker.ts')
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    throw new Error('Could not find v2-parser-worker')
  }
}

