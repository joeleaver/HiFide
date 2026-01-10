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

export class PriorityIndexingQueue {
  private items: QueueItem[] = []
  private lastRoundRobinWorkspace: string | null = null

  /**
   * Push indexing events to the queue
   * Deduplicates per workspace+path and maintains priority order
   */
  push(workspaceId: string, events: IndexingEvent[], type: IndexingType): void {
    const priority = this.getPriority(type)

    for (const event of events) {
      const existingIndex = this.items.findIndex(
        item => item.workspaceId === workspaceId && item.path === event.path
      )

      if (existingIndex !== -1) {
        // Deduplicate: update existing item
        const existing = this.items[existingIndex]

        if (event.type === 'unlink') {
          // Unlink overrides everything
          this.items[existingIndex] = {
            workspaceId,
            type,
            priority: Math.max(existing.priority, priority),
            path: event.path,
            timestamp: event.timestamp,
            event
          }
        } else if (existing.event.type === 'add') {
          // Keep as add, but update timestamp/priority
          this.items[existingIndex] = {
            ...existing,
            timestamp: event.timestamp,
            priority: Math.max(existing.priority, priority)
          }
        } else {
          // Update to new event
          this.items[existingIndex] = {
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
        this.items.push({
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
    const workspaces = Array.from(new Set(this.items.map(item => item.workspaceId)))

    if (workspaces.length === 0) return []

    // Find next workspace in round-robin order
    let startIndex = 0
    if (this.lastRoundRobinWorkspace) {
      startIndex = workspaces.indexOf(this.lastRoundRobinWorkspace) + 1
      if (startIndex >= workspaces.length) startIndex = 0
    }

    // Pop items round-robin from each workspace
    for (let i = 0; i < count && this.items.length > 0; i++) {
      const wsIndex = (startIndex + i) % workspaces.length
      const ws = workspaces[wsIndex]

      const itemIndex = this.items.findIndex(item => item.workspaceId === ws)
      if (itemIndex !== -1) {
        const item = this.items[itemIndex]
        result.push(item)
        this.items.splice(itemIndex, 1)
        this.lastRoundRobinWorkspace = ws
      }
    }

    return result
  }

  /**
   * Peek at the next item without removing it
   */
  peek(): QueueItem | undefined {
    return this.items[0]
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.items = []
    this.lastRoundRobinWorkspace = null
  }

  /**
   * Clear items for a specific workspace
   */
  clearWorkspace(workspaceId: string): void {
    this.items = this.items.filter(item => item.workspaceId !== workspaceId)
  }

  /**
   * Get total queue length
   */
  getQueueLength(): number {
    return this.items.length
  }

  /**
   * Get queue length for a specific workspace
   */
  getWorkspaceQueueLength(workspaceId: string): number {
    return this.items.filter(item => item.workspaceId === workspaceId).length
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
    this.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.timestamp - b.timestamp
    })
  }
}

