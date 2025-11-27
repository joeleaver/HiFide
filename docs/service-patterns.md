# Service Architecture Patterns

This document describes the patterns established during the Zustand-to-Services migration.

## Overview

The service architecture replaces Zustand slices with simple TypeScript classes that:
- Extend a base `Service<TState>` class
- Manage their own state directly (no `set()` wrappers)
- Handle persistence explicitly via `PersistenceManager`
- Emit events for internal communication
- Are registered in a central `ServiceRegistry` for dependency injection

## Core Components

### 1. Service Base Class

All services extend `Service<TState>`:

```typescript
export abstract class Service<TState extends Record<string, any>> {
  protected state: TState
  protected events: EventEmitter
  protected persistence: PersistenceManager
  
  constructor(initialState: TState, persistKey?: string)
  
  protected setState(updates: Partial<TState>): void
  protected abstract onStateChange(updates: Partial<TState>, prevState: TState): void
  
  getState(): Readonly<TState>
  on(event: string, listener: (...args: any[]) => void): void
  emit(event: string, ...args: any[]): void
}
```

### 2. PersistenceManager

Wraps `electron-store` with typed methods:

```typescript
class PersistenceManager {
  save<T>(key: string, value: T): void
  load<T>(key: string, defaultValue: T): T
  has(key: string): boolean
  delete(key: string): void
}
```

### 3. ServiceRegistry

Singleton for service lookup and dependency injection:

```typescript
class ServiceRegistry {
  static getInstance(): ServiceRegistry
  register(name: string, service: any): void
  get<T>(name: string): T
  has(name: string): boolean
}
```

## Migration Patterns

### Pattern 1: Simple Service (No Dependencies)

**Example: DebugService**

```typescript
interface DebugState {
  logs: DebugLogEntry[]
}

export class DebugService extends Service<DebugState> {
  constructor() {
    super({ logs: [] }) // No persistence
  }
  
  addLog(level: string, category: string, message: string, data?: any): void {
    const entry = { timestamp: Date.now(), level, category, message, data }
    const newLogs = [...this.state.logs, entry]
    
    if (newLogs.length > MAX_DEBUG_LOGS) {
      this.setState({ logs: newLogs.slice(-MAX_DEBUG_LOGS) })
    } else {
      this.setState({ logs: newLogs })
    }
  }
  
  protected onStateChange(): void {
    // No persistence or notifications needed
  }
}
```

### Pattern 2: Service with Persistence

**Example: ViewService**

```typescript
interface ViewState {
  currentView: ViewType
}

export class ViewService extends Service<ViewState> {
  constructor() {
    super({ currentView: 'flow' }, 'view') // With persistence key
  }
  
  setView(view: ViewType): void {
    if (this.state.currentView === view) return
    this.setState({ currentView: view })
  }
  
  protected onStateChange(updates: Partial<ViewState>): void {
    if (updates.currentView !== undefined) {
      // Persist the change
      this.persistFields(['currentView'])
      
      // Emit event for local listeners
      this.emit('view:changed', updates.currentView)
      
      // WebSocket notification (when implemented)
      // broadcastWorkspaceNotification('view:changed', { view: updates.currentView })
    }
  }
}
```

### Pattern 3: Service with Complex State

**Example: UiService**

```typescript
interface UiState {
  windowState: WindowState
}

export class UiService extends Service<UiState> {
  constructor() {
    const persisted = this.persistence.load<WindowState>('windowState', DEFAULT_WINDOW_STATE)
    super({ windowState: persisted }, 'ui')
  }
  
  updateWindowState(updates: Partial<WindowState>): void {
    // Shallow compare to avoid unnecessary updates
    const keys = Object.keys(updates) as (keyof WindowState)[]
    let changed = false
    for (const k of keys) {
      if (this.state.windowState[k] !== updates[k]) {
        changed = true
        break
      }
    }
    
    if (!changed) return
    
    this.setState({
      windowState: { ...this.state.windowState, ...updates }
    })
  }
  
  persistWindowState(updates: Partial<WindowState>): void {
    // Persist without broadcasting (for high-frequency updates)
    const current = this.persistence.load<WindowState>('windowState', DEFAULT_WINDOW_STATE)
    const next = { ...current, ...updates }
    this.persistence.save('windowState', next)
    this.state.windowState = next // Update in-memory without triggering onStateChange
  }
  
  protected onStateChange(updates: Partial<UiState>): void {
    if (updates.windowState) {
      this.persistence.save('windowState', updates.windowState)
      this.emit('windowState:changed', updates.windowState)
    }
  }
}
```

## WebSocket JSON-RPC Integration

Services are accessed via the ServiceRegistry in RPC handlers:

```typescript
// Before (Zustand)
addMethod('view.get', async () => {
  const st: any = useMainStore.getState()
  return { ok: true, currentView: st.currentView }
})

// After (Services)
addMethod('view.get', async () => {
  const { getViewService } = await import('../../services/index.js')
  const viewService = getViewService()
  return { ok: true, currentView: viewService.getCurrentView() }
})
```

## Testing

Services are easy to test in isolation:

```typescript
describe('ViewService', () => {
  it('should set current view', () => {
    const service = new ViewService()
    service.setView('explorer')
    expect(service.getCurrentView()).toBe('explorer')
  })
  
  it('should emit events on change', () => {
    const service = new ViewService()
    let emitted = false
    service.on('view:changed', () => { emitted = true })
    service.setView('settings')
    expect(emitted).toBe(true)
  })
})
```

## Benefits Over Zustand

1. **Simpler code**: Direct method calls instead of `set()` wrappers
2. **Better TypeScript**: Regular classes with full type inference
3. **Explicit control flow**: No middleware chains or magic
4. **Easier testing**: Services can be instantiated and tested in isolation
5. **No framework lock-in**: Plain TypeScript classes
6. **Clearer intent**: Persistence and notifications are explicit, not hidden in middleware

## Next Steps

Phase 2 will migrate medium-complexity slices with cross-service dependencies:
- Planning
- App
- Workspace
- Explorer
- Indexing

These will establish patterns for:
- Service-to-service communication
- Workspace-scoped state
- Async initialization
- Event-driven updates

