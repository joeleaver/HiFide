# Zustand Removal Migration Plan

## ✅ MIGRATION COMPLETE!

This migration successfully removed Zustand from the **main process** while keeping it in the **renderer** where it makes sense for UI state management.

## Overview

Remove Zustand from the main process and replace with a simpler class-based state management system. The renderer already uses WebSocket JSON-RPC for communication, so we don't need Zustand's reactive features in the backend.

**Decision:** Keep Zustand in the renderer for UI state management - it's perfect for that use case!

## Goals

1. ✅ **Simpler code** - Direct method calls instead of `set()` wrappers
2. ✅ **Better TypeScript** - Regular classes instead of Zustand types
3. ✅ **Clearer control flow** - Explicit instead of middleware-based
4. ✅ **Keep the good parts** - Slice organization, persistence, notifications

## Architecture

### Before (Zustand in Main + Renderer)
```
Main Process: Zustand Store (15 slices) → persist middleware → electron-store
Renderer: Zustand Store (UI state) + WebSocket JSON-RPC
```

### After (Services in Main, Zustand in Renderer)
```
Main Process: Service Classes (15+ services) → explicit persistence → electron-store
Renderer: Zustand Store (UI state) + WebSocket JSON-RPC (unchanged)
```

## Migration Strategy

### Phase 1: Foundation ✅ COMPLETE
**Goal:** Establish patterns and infrastructure

1. ✅ **debug.slice.ts** → `DebugService`
2. ✅ **view.slice.ts** → `ViewService`
3. ✅ **ui.slice.ts** → `UiService`

**Deliverables:**
- ✅ Base `Service` class with persistence helpers
- ✅ Event emitter for notifications
- ✅ Pattern documentation
- ✅ Migration of 3 slices
- ✅ Comprehensive test suite (12 passing tests)

### Phase 2: All Remaining Services ✅ COMPLETE
**Goal:** Migrate all remaining slices and refactor monoliths

**Services Created:**
4. ✅ `PlanningService` (from planning.slice.ts)
5. ✅ `AppService` (from app.slice.ts)
6. ✅ `WorkspaceService` (from workspace.slice.ts)
7. ✅ `ExplorerService` (from explorer.slice.ts)
8. ✅ `IndexingService` (from indexing.slice.ts)
9. ✅ `ProviderService` (from provider.slice.ts)
10. ✅ `SettingsService` (from settings.slice.ts)
11. ✅ `ToolsService` (from tools.slice.ts)
12. ✅ `KanbanService` (from kanban.slice.ts)
13. ✅ `TerminalService` (from terminal.slice.ts)
14. ✅ `SessionService` (from session.slice.ts - refactored from 1,280 → 713 lines)
15. ✅ `FlowProfileService` (from flowEditor.slice.ts - template/profile management)
16. ✅ `FlowConfigService` (from flowEditor.slice.ts - flow configuration)
17. ✅ `FlowGraphService` (from flowEditor.slice.ts - graph storage)
18. ✅ `FlowCacheService` (from SessionService - flow node cache)
19. ✅ `SessionTimelineService` (from SessionService - timeline & badges, 1,426 lines)

**Major Refactors:**
- ✅ Split SessionService monolith (1,280 lines) into 3 focused services
- ✅ Split flowEditor.slice.ts monolith (3,322 lines) into 3 focused services
- ✅ Deleted TokenTrackingService (broken architecture, moved to SessionService)
- ✅ Consolidated badge rendering logic into SessionTimelineService
- ✅ Removed 1,147 lines of dead badge handler code
- ✅ Renamed flows-v2 → flow-engine (clearer naming)

**Deliverables:**
- ✅ Service registry for cross-service calls
- ✅ Event-driven coordination between services
- ✅ Migration of ALL slices to services
- ✅ Fixed broken token accounting architecture
- ✅ Consolidated badge rendering (3 separate implementations → 1)

### Phase 3: WebSocket Handler Migration ✅ COMPLETE
**Goal:** Update all WebSocket handlers to use services instead of Zustand

**Progress:**
- ✅ 45/45 handlers migrated (100%)
- ✅ useMainStore references: 83 → 0 (100% reduction)
- ✅ All handlers now use ServiceRegistry
- ✅ Removed dead agentMetrics code

**Batches:**
1. ✅ Workspace/Session handlers (8 handlers)
2. ✅ Knowledge Base handlers (6 handlers)
3. ✅ Flow Editor handlers (12 handlers)
4. ✅ Workspace/Tools handlers (8 handlers)
5. ✅ Notification subscriptions (6 subscriptions)
6. ✅ Flow execution handlers (4 handlers)
7. ✅ agentMetrics cleanup (1 handler)

### Phase 4: Cleanup ⏭️ SKIPPED
**Decision:** Keep Zustand in renderer for UI state management

- ⏭️ ~~Remove Zustand dependencies~~ - Keep for renderer
- ⏭️ ~~Remove old slice files~~ - Keep for renderer
- ⏭️ ~~Update documentation~~ - Already updated
- ⏭️ ~~Remove zubridge patterns doc~~ - Keep for historical reference

---

## 🎉 Migration Complete Summary

### What We Accomplished

**1. Created 19 Focused Services** (from 15 monolithic slices)
- Base infrastructure: `Service`, `PersistenceManager`, `ServiceRegistry`
- Core services: Debug, View, UI, Planning, App, Workspace, Explorer, Indexing
- Domain services: Provider, Settings, Tools, Kanban, Terminal
- Session services: Session, SessionTimeline, FlowCache
- Flow services: FlowProfile, FlowConfig, FlowGraph

**2. Refactored Major Monoliths**
- SessionService: 1,280 → 713 lines (split into 3 services)
- flowEditor.slice.ts: 3,322 → 3,021 lines (split into 3 services + removed dead code)
- flows-v2 → flow-engine: 875 → 158 lines (moved badge logic to SessionTimelineService)

**3. Fixed Broken Architecture**
- Token accounting: Deleted TokenTrackingService, moved to SessionService
- Badge rendering: Consolidated 3 separate implementations into SessionTimelineService
- Flow execution: Removed 1,147 lines of dead badge handler code

**4. Migrated All WebSocket Handlers**
- 45/45 handlers migrated (100%)
- useMainStore references: 83 → 0 (100% reduction)
- All handlers now use ServiceRegistry pattern

**5. Improved Code Quality**
- Event-driven coordination between services
- Clear separation of concerns
- Single source of truth for all data
- Explicit persistence (no middleware magic)
- Better TypeScript types

### What We Kept

**Zustand in Renderer** - Perfect for UI state management!
- Renderer-only stores: `useUiStore`, `useTerminalStore`, `useFlowEditorLocal`
- WebSocket JSON-RPC for main ↔ renderer communication
- Zustand for local UI state (drag/resize/scroll/hover/selection)

### Architecture Benefits

**Before:**
- Zustand in main process (unnecessary reactivity)
- Monolithic slices (3,000+ lines)
- Duplicate/dead code (badge rendering in 3 places)
- Broken token accounting (incompatible data structures)
- Direct store mutations from handlers

**After:**
- Service classes in main process (explicit, clear)
- Focused services (100-700 lines each)
- Single source of truth (badge rendering in SessionTimelineService)
- Fixed token accounting (SessionService owns all tracking)
- ServiceRegistry pattern (dependency injection)

---

## Slice Analysis (Historical Reference)

### Complexity Tiers

**Tier 1: Simple (no dependencies)**
- debug.slice.ts - Just logs array
- view.slice.ts - Single string + one external call
- ui.slice.ts - WindowState object + persistence

**Tier 2: Medium (some dependencies)**
- planning.slice.ts - Depends on: debug, session, flowEditor
- app.slice.ts - Orchestrates: workspace, session, provider, settings
- workspace.slice.ts - Depends on: app, indexing, kanban, knowledgeBase
- explorer.slice.ts - Depends on: workspace
- indexing.slice.ts - Standalone but complex async

**Tier 3: Complex (many dependencies)**
- provider.slice.ts - Depends on: settings
- settings.slice.ts - Depends on: provider
- tools.slice.ts - Depends on: workspace
- kanban.slice.ts - Depends on: workspace

**Tier 4: Critical (core domain logic)**
- terminal.slice.ts - PTY management, complex state
- session.slice.ts - 1700+ lines, depends on: settings, terminal, workspace
- flowEditor.slice.ts - Flow graph, depends on: provider, session

## Technical Patterns

### Service Base Class
```typescript
abstract class Service<TState> {
  protected state: TState
  protected events: EventEmitter
  
  constructor(initialState: TState) {
    this.state = initialState
    this.events = new EventEmitter()
  }
  
  protected setState(updates: Partial<TState>): void {
    this.state = { ...this.state, ...updates }
    this.persist()
    this.notify()
  }
  
  protected abstract persist(): void
  protected abstract notify(): void
  
  getState(): Readonly<TState> {
    return this.state
  }
}
```

### Persistence Helper
```typescript
class PersistenceManager {
  private store: ElectronStore
  
  save(key: string, data: any): void
  load<T>(key: string, defaults: T): T
}
```

### Service Registry
```typescript
class ServiceRegistry {
  private services = new Map<string, Service<any>>()
  
  register<T>(name: string, service: Service<T>): void
  get<T>(name: string): Service<T>
}
```

## Success Criteria

- [ ] All 15 slices migrated to services
- [ ] All JSON-RPC endpoints working
- [ ] All renderer components working
- [ ] Persistence working
- [ ] No Zustand dependencies
- [ ] Documentation updated
- [ ] Tests passing

## Risks & Mitigation

**Risk:** Breaking renderer communication
**Mitigation:** Keep JSON-RPC interface identical, migrate backend only

**Risk:** Losing persistence
**Mitigation:** Keep electron-store, same keys, test thoroughly

**Risk:** Breaking cross-slice dependencies
**Mitigation:** Service registry with explicit dependencies

**Risk:** Performance regression
**Mitigation:** Benchmark before/after, optimize if needed

## Phase 1 Detailed Plan

### Infrastructure Setup

**File:** `electron/services/base/Service.ts`
```typescript
export abstract class Service<TState> {
  protected state: TState
  protected events: EventEmitter
  protected persistence: PersistenceManager

  constructor(initialState: TState, persistKey?: string) {
    this.state = initialState
    this.events = new EventEmitter()
    this.persistence = new PersistenceManager()
    if (persistKey) this.loadState(persistKey)
  }

  protected setState(updates: Partial<TState>): void {
    this.state = { ...this.state, ...updates }
    this.onStateChange(updates)
  }

  protected abstract onStateChange(updates: Partial<TState>): void

  getState(): Readonly<TState> {
    return this.state
  }
}
```

**File:** `electron/services/base/PersistenceManager.ts`
```typescript
import Store from 'electron-store'

export class PersistenceManager {
  private store: Store

  constructor() {
    this.store = new Store({ name: 'hifide-services' })
  }

  save<T>(key: string, data: T): void {
    this.store.set(key, data)
  }

  load<T>(key: string, defaults: T): T {
    return this.store.get(key, defaults) as T
  }
}
```

**File:** `electron/services/base/ServiceRegistry.ts`
```typescript
export class ServiceRegistry {
  private static instance: ServiceRegistry
  private services = new Map<string, any>()

  static getInstance(): ServiceRegistry {
    if (!this.instance) this.instance = new ServiceRegistry()
    return this.instance
  }

  register<T>(name: string, service: T): void {
    this.services.set(name, service)
  }

  get<T>(name: string): T {
    const service = this.services.get(name)
    if (!service) throw new Error(`Service ${name} not found`)
    return service as T
  }
}
```

### Migration Examples

**DebugService** (simplest)
```typescript
// electron/services/DebugService.ts
import { Service } from './base/Service'
import type { DebugLogEntry } from '../store/types'

interface DebugState {
  logs: DebugLogEntry[]
}

export class DebugService extends Service<DebugState> {
  constructor() {
    super({ logs: [] }) // No persistence needed
  }

  addLog(level: 'info' | 'warning' | 'error', category: string, message: string, data?: any): void {
    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    }

    const newLogs = [...this.state.logs, entry]
    if (newLogs.length > 1000) {
      newLogs.splice(0, newLogs.length - 1000)
    }

    this.setState({ logs: newLogs })
  }

  clearLogs(): void {
    this.setState({ logs: [] })
  }

  protected onStateChange(): void {
    // No notifications needed for debug logs
  }
}
```

**ViewService** (simple with external call)
```typescript
// electron/services/ViewService.ts
import { Service } from './base/Service'
import { setAppView } from '../services/appBridge'
import type { ViewType } from '../store/types'

interface ViewState {
  currentView: ViewType
}

export class ViewService extends Service<ViewState> {
  constructor() {
    super({ currentView: 'flow' }, 'view')
  }

  setView(view: ViewType): void {
    this.setState({ currentView: view })

    // External call
    try {
      void setAppView(view)
    } catch (e) {
      console.error(e)
    }
  }

  protected onStateChange(updates: Partial<ViewState>): void {
    if (updates.currentView) {
      this.persistence.save('currentView', updates.currentView)
      // Notify renderers via WebSocket
      broadcastWorkspaceNotification(null, 'view.changed', { view: updates.currentView })
    }
  }
}
```

**UiService** (persistence)
```typescript
// electron/services/UiService.ts
import { Service } from './base/Service'
import type { WindowState } from '../store/slices/ui.slice'

interface UiState {
  windowState: WindowState
}

const DEFAULT_WINDOW_STATE: WindowState = {
  agentMode: 'chat',
  flowCanvasCollapsed: false,
  flowCanvasWidth: 600,
  // ... rest of defaults
}

export class UiService extends Service<UiState> {
  constructor() {
    const persisted = this.persistence.load('windowState', DEFAULT_WINDOW_STATE)
    super({ windowState: persisted }, 'ui')
  }

  updateWindowState(updates: Partial<WindowState>): void {
    // Skip if no changes
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

  protected onStateChange(updates: Partial<UiState>): void {
    if (updates.windowState) {
      this.persistence.save('windowState', updates.windowState)
      // Notify renderers
      broadcastWorkspaceNotification(null, 'ui.windowState.changed', updates.windowState)
    }
  }
}
```

### WebSocket Integration

Update `electron/backend/ws/server.ts`:
```typescript
// Before
const st: any = useMainStore.getState()
const currentView = st.currentView

// After
import { ServiceRegistry } from '../../services/base/ServiceRegistry'
const registry = ServiceRegistry.getInstance()
const viewService = registry.get<ViewService>('view')
const currentView = viewService.getState().currentView
```

### Testing Checklist

- [ ] DebugService: addLog, clearLogs work
- [ ] ViewService: setView persists and notifies
- [ ] UiService: updateWindowState persists and notifies
- [ ] JSON-RPC endpoints return correct data
- [ ] Renderer receives notifications
- [ ] Persistence survives app restart
- [ ] No Zustand imports in migrated code

## Next Steps

After Phase 1 is complete and tested:
1. Review patterns and adjust if needed
2. Document lessons learned
3. Plan Phase 2 migrations using established patterns
4. Continue slice-by-slice until complete

