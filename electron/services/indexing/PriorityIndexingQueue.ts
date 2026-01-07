/**
 * PriorityIndexingQueue
 * 
 * Global queue that manages indexing tasks across all workspaces.
 * Implements 3-tier prioritization: Memories (3) > KB (2) > Code (1)
 * Supports round-robin workspace selection for fair scheduling.
 */

import { IndexingEvent } from './types.js'

export type IndexingType = 'code' | 'kb' | 'memories'

interface QueueItem {
  workspaceId: string
  type: IndexingType
  priority: number // 3=memories, 2=kb, 1=code
  path: string
  timestamp: number
  event: IndexingEvent
}

interface QueueState {
  items: QueueItem[]
  workspaceQueues: Map<string, number[]> // workspaceId -> indices in items
}

export class PriorityIndexingQueue {
  private state: QueueState = {
    items: [],
    workspaceQueues: new Map()
  }

  private lastRoundRobinWorkspace: string | null = null

  /**
   * Push indexing events to the queue
   * Deduplicates per workspace+path and maintains priority order
   */
  push(workspaceId: string, events: IndexingEvent[], type: IndexingType): void {
    const priority = this.getPriority(type)

    for (const event of events) {
      const existingIndex = this.state.items.findIndex(
        item => item.workspaceId === workspaceId && item.path === event.path
      )

      if (existingIndex !== -1) {
        // Deduplicate: update existing item
        const existing = this.state.items[existingIndex]

        if (event.type === 'unlink') {
          // Unlink overrides everything
          this.state.items[existingIndex] = {
            workspaceId,
            type,
            priority: Math.max(existing.priority, priority),
            path: event.path,
            timestamp: event.timestamp,
            event
          }
        } else if (existing.event.type === 'add') {
          // Keep as add, but update timestamp/priority
          this.state.items[existingIndex] = {
            ...existing,
            timestamp: event.timestamp,
            priority: Math.max(existing.priority, priority)
          }
        } else {
          // Update to new event
          this.state.items[existingIndex] = {
            workspaceId,
            type,
            priority: Math.max(existing.priority, priority),
            path: event.path,
            timestamp: event.timestamp,
            event
          }
        }
      } else {
        // Add new item
        this.state.items.push({
          workspaceId,
          type,
          priority,
          path: event.path,
          timestamp: event.timestamp,
          event
        })
      }
    }

    this.sort()
  }

  /**
   * Pop items from the queue using round-robin workspace selection
   * This ensures fair distribution of work across workspaces
   */
  pop(count: number): QueueItem[] {
    const result: QueueItem[] = []
    const workspaces = Array.from(new Set(this.state.items.map(item => item.workspaceId)))

    if (workspaces.length === 0) return []

    // Find next workspace in round-robin order
    let startIndex = 0
    if (this.lastRoundRobinWorkspace) {
      startIndex = workspaces.indexOf(this.lastRoundRobinWorkspace) + 1
      if (startIndex >= workspaces.length) startIndex = 0
    }

    // Pop items round-robin from each workspace
    for (let i = 0; i < count && this.state.items.length > 0; i++) {
      const wsIndex = (startIndex + i) % workspaces.length
      const ws = workspaces[wsIndex]

      const itemIndex = this.state.items.findIndex(item => item.workspaceId === ws)
      if (itemIndex !== -1) {
        const item = this.state.items[itemIndex]
        result.push(item)
        this.state.items.splice(itemIndex, 1)
        this.lastRoundRobinWorkspace = ws
      }
    }

    return result
  }

  /**
   * Peek at the next item without removing it
   */
  peek(): QueueItem | undefined {
    return this.state.items[0]
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.state.items = []
    this.state.workspaceQueues.clear()
    this.lastRoundRobinWorkspace = null
  }

  /**
   * Clear items for a specific workspace
   */
  clearWorkspace(workspaceId: string): void {
    this.state.items = this.state.items.filter(item => item.workspaceId !== workspaceId)
    this.state.workspaceQueues.delete(workspaceId)
  }

  /**
   * Get total queue length
   */
  getQueueLength(): number {
    return this.state.items.length
  }

  /**
   * Get queue length for a specific workspace
   */
  getWorkspaceQueueLength(workspaceId: string): number {
    return this.state.items.filter(item => item.workspaceId === workspaceId).length
  }

  /**
   * Get priority for indexing type
   */
  private getPriority(type: IndexingType): number {
    switch (type) {
      case 'memories':
        return 3
      case 'kb':
        return 2
      case 'code':
        return 1
      default:
        return 0
    }
  }

  /**
   * Sort queue by priority (desc) then timestamp (asc)
   */
  private sort(): void {
    this.state.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.timestamp - b.timestamp
    })
  }
}

