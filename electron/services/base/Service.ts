/**
 * Base Service Class
 * 
 * Abstract base class for all services that replace Zustand slices.
 * Provides state management, persistence, and notification capabilities.
 */

import { EventEmitter } from 'node:events'
import { PersistenceManager } from './PersistenceManager'

export abstract class Service<TState extends Record<string, any>> {
  protected state: TState
  protected events: EventEmitter
  protected persistence: PersistenceManager
  private persistKey: string | null

  constructor(initialState: TState, persistKey?: string) {
    this.state = initialState
    this.events = new EventEmitter()
    this.persistence = new PersistenceManager()
    this.persistKey = persistKey || null

    // Load persisted state if key provided
    if (this.persistKey) {
      this.loadPersistedState()
    }
  }

  /**
   * Get current state (read-only)
   */
  getState(): Readonly<TState> {
    return this.state
  }

  /**
   * Update state and trigger side effects
   */
  protected setState(updates: Partial<TState>): void {
    const prevState = { ...this.state }
    this.state = { ...this.state, ...updates }
    
    // Call lifecycle hook
    this.onStateChange(updates, prevState)
  }

  /**
   * Lifecycle hook called after state changes
   * Override to implement persistence, notifications, etc.
   */
  protected abstract onStateChange(updates: Partial<TState>, prevState: TState): void

  /**
   * Load persisted state from storage
   */
  private loadPersistedState(): void {
    if (!this.persistKey) return

    try {
      const persisted = this.persistence.load<Partial<TState>>(this.persistKey, {})
      if (persisted && Object.keys(persisted).length > 0) {
        this.state = { ...this.state, ...persisted }
      }
    } catch (error) {
      console.error(`[Service] Failed to load persisted state for ${this.persistKey}:`, error)
    }
  }

  /**
   * Helper to persist entire state
   */
  protected persistState(): void {
    if (!this.persistKey) return

    try {
      this.persistence.save(this.persistKey, this.state)
    } catch (error) {
      console.error(`[Service] Failed to persist state for ${this.persistKey}:`, error)
    }
  }

  /**
   * Helper to persist specific fields
   */
  protected persistFields(fields: (keyof TState)[]): void {
    if (!this.persistKey) return

    try {
      const current = this.persistence.load<Partial<TState>>(this.persistKey, {})
      const updates: Partial<TState> = {}
      
      for (const field of fields) {
        updates[field] = this.state[field]
      }
      
      this.persistence.save(this.persistKey, { ...current, ...updates })
    } catch (error) {
      console.error(`[Service] Failed to persist fields for ${this.persistKey}:`, error)
    }
  }

  /**
   * Emit an event
   */
  protected emit(event: string, ...args: any[]): void {
    this.events.emit(event, ...args)
  }

  /**
   * Subscribe to an event
   */
  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener)
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, listener: (...args: any[]) => void): void {
    this.events.off(event, listener)
  }

  /**
   * Subscribe to an event once
   */
  once(event: string, listener: (...args: any[]) => void): void {
    this.events.once(event, listener)
  }
}

