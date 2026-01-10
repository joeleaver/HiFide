/**
 * WorkspaceIndexingManager
 * 
 * Manages indexing for a single workspace.
 * Handles watcher lifecycle, status tracking, and communication with GlobalIndexingOrchestrator.
 */

import { EventEmitter } from 'node:events'
import path from 'node:path'
import { WatcherService } from './WatcherService.js'
import { IndexingEvent } from './types.js'

export interface WorkspaceIndexingState {
  workspaceId: string
  status: 'idle' | 'indexing' | 'paused'
  code: { total: number; indexed: number; missing: number; stale: number }
  kb: { total: number; indexed: number; missing: number; stale: number }
  memories: { total: number; indexed: number; missing: number; stale: number }
  indexingEnabled: boolean
  totalFilesDiscovered: number
  indexedCount: number
  activeWorkers: number
}

export class WorkspaceIndexingManager extends EventEmitter {
  private workspaceId: string
  private state: WorkspaceIndexingState
  private watcher: WatcherService
  private eventsHandler: ((events: IndexingEvent[]) => void) | null = null

  constructor(workspaceId: string) {
    super()
    this.workspaceId = path.resolve(workspaceId)

    this.state = {
      workspaceId: this.workspaceId,
      status: 'idle',
      code: { total: 0, indexed: 0, missing: 0, stale: 0 },
      kb: { total: 0, indexed: 0, missing: 0, stale: 0 },
      memories: { total: 0, indexed: 0, missing: 0, stale: 0 },
      indexingEnabled: true,
      totalFilesDiscovered: 0,
      indexedCount: 0,
      activeWorkers: 0
    }

    this.watcher = new WatcherService()
  }

  /**
   * Get current state
   */
  getState(): WorkspaceIndexingState {
    return { ...this.state }
  }

  /**
   * Update state and emit change event
   */
  updateState(updates: Partial<WorkspaceIndexingState>): void {
    this.state = { ...this.state, ...updates }
    this.emit('state-changed', this.state)
  }

  /**
   * Get the watcher service
   */
  getWatcher(): WatcherService {
    return this.watcher
  }

  /**
   * Start the file watcher
   */
  async startWatcher(options?: any): Promise<void> {
    console.log(`[WorkspaceIndexingManager] Starting watcher for ${this.workspaceId}`)

    // Remove any existing handler before registering a new one
    if (this.eventsHandler) {
      this.watcher.off('events', this.eventsHandler)
      this.eventsHandler = null
    }

    // Create and register new handler
    this.eventsHandler = (events: IndexingEvent[]) => {
      console.log(
        `[WorkspaceIndexingManager] [${this.workspaceId}] Received ${events.length} file events`
      )

      // Update counts based on events
      let totalDelta = 0
      let indexedDelta = 0
      let missingDelta = 0

      for (const event of events) {
        if (event.type === 'change') {
          indexedDelta--
        } else if (event.type === 'unlink') {
          indexedDelta--
          totalDelta--
        } else if (event.type === 'add') {
          totalDelta++
          missingDelta++
        }
      }

      if (totalDelta !== 0 || indexedDelta !== 0 || missingDelta !== 0) {
        this.updateState({
          code: {
            total: Math.max(0, this.state.code.total + totalDelta),
            indexed: Math.max(0, this.state.code.indexed + indexedDelta),
            missing: Math.max(0, this.state.code.missing + missingDelta),
            stale: this.state.code.stale
          }
        })
      }

      // Emit events for GlobalIndexingOrchestrator to handle
      this.emit('file-events', events)
    }

    this.watcher.on('events', this.eventsHandler)

    await this.watcher.start(this.workspaceId, options)

    // Wait for watcher to be ready
    return new Promise<void>(resolve => {
      const onReady = (data?: { totalFiles: number }) => {
        const totalFiles = data?.totalFiles || 0
        console.log(
          `[WorkspaceIndexingManager] Watcher ready for ${this.workspaceId} with ${totalFiles} files`
        )
        this.watcher.off('ready', onReady)
        this.updateState({ totalFilesDiscovered: totalFiles })
        resolve()
      }
      this.watcher.on('ready', onReady)
    })
  }

  /**
   * Stop the file watcher
   */
  async stopWatcher(): Promise<void> {
    console.log(`[WorkspaceIndexingManager] Stopping watcher for ${this.workspaceId}`)
    await this.watcher.stop()
  }

  /**
   * Set indexing enabled state
   */
  setIndexingEnabled(enabled: boolean): void {
    this.updateState({ indexingEnabled: enabled })
  }

  /**
   * Set status
   */
  setStatus(status: 'idle' | 'indexing' | 'paused'): void {
    this.updateState({ status })
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log(`[WorkspaceIndexingManager] Cleaning up ${this.workspaceId}`)
    // Remove events handler before stopping watcher
    if (this.eventsHandler) {
      this.watcher.off('events', this.eventsHandler)
      this.eventsHandler = null
    }
    await this.stopWatcher()
    this.removeAllListeners()
  }
}

