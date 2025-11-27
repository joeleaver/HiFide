# Zustand Removal - Next Steps

## Current Status

All **18 services** have been created successfully! The service architecture is complete.

### ✅ Completed Services (18/18)

1. **DebugService** - Debug logging
2. **ViewService** - Current view management
3. **UiService** - Window state
4. **ToolsService** - Tool categories
5. **WorkspaceService** - Workspace management
6. **ExplorerService** - File explorer state
7. **ProviderService** - LLM provider/model management
8. **SettingsService** - API keys, validation, pricing
9. **PlanningService** - Approved plan execution
10. **KanbanService** - Kanban board CRUD
11. **KnowledgeBaseService** - KB items and semantic search
12. **AppService** - App initialization
13. **IndexingService** - Code indexing
14. **TerminalService** - PTY management
15. **FlowExecutionService** - Flow lifecycle
16. **FlowProfileService** - Template/profile management
17. **FlowConfigService** - Flow configuration
18. **SessionService** - Session management (1,280 lines)

---

## Remaining Integration Work

### 1. Update WebSocket JSON-RPC Handlers ⏳ IN PROGRESS

**File**: `electron/backend/ws/server.ts` (2,844 lines)

**Status**: Started - created `electron/backend/ws/service-handlers.ts` with helper functions

**What's Done**:
- Created service-based handler implementations for:
  - Session handlers (getCurrent, list, select, newSession, etc.)
  - Kanban handlers (getBoard, load, save, createTask, etc.)
  - Provider handlers (refreshModels, setDefaultModel, etc.)
  - Settings handlers (get, setApiKeys, validateKeys, etc.)
  - Flow handlers (getNodeCache, clearNodeCache)

**What Remains**:
- Replace all `useMainStore.getState()` calls in `server.ts` with service calls
- Update ~68 RPC method handlers to use the new service-handlers
- Pattern to follow:
  ```typescript
  // OLD
  addMethod('session.list', async () => {
    const st: any = useMainStore.getState()
    const list = st.getSessionsFor({ workspaceId: bound })
    // ...
  })

  // NEW
  addMethod('session.list', async () => {
    const bound = getConnectionWorkspaceId(connection)
    if (!bound) return { ok: false, error: 'no-workspace' }
    return await sessionHandlers.list(bound)
  })
  ```

**Estimated Effort**: 2-3 hours (systematic replacement of ~68 handlers)

---

### 2. Simplify Flow Event Handlers & Move Badge Logic to Renderer ⏳ NOT STARTED

**Files**:
- `electron/flow-engine/index.ts` (lines 278-586) - Simplify to use SessionService
- `src/services/flowEventProcessor.ts` (new file) - Badge creation logic

**Current Problem**: Main process has ~260 lines of UI-specific badge creation logic that should be in renderer

**Current Flow**:
```
Scheduler → Raw Events → Main Event Handler → Badge Objects → Session Timeline → Renderer Display
                         ^^^^^^^^^^^^^^^^^^^^^^^^
                         UI logic in main process!
```

**Correct Flow**:
```
Scheduler → Raw Events → SessionService → Raw Event Data → Renderer → Badge Objects → Display
                                                           ^^^^^^^^^^^^^^^^^^^^^^^^
                                                           UI logic in renderer!
```

**Changes Needed**:

#### A. Simplify Main Process Event Handlers

**File**: `electron/flow-engine/index.ts`

Replace complex badge creation (lines 308-570) with simple event storage:

```typescript
// OLD - Creates UI-specific badge objects
if (t === 'toolStart' && key && nid) {
  const arr = badgeQueues.get(key) || []
  const label = formatToolName(ev.toolName || 'Tool')  // ❌ UI logic
  const { normalized, key: tkey } = normalizeTool(ev.toolName || '')
  let metadata: any = undefined
  if (normalized === 'fs_read_lines') {
    metadata = deriveFsReadLinesMeta(ev.toolArgs)  // ❌ UI logic
  }
  arr.push({ id: ev.callId, type: 'tool', label, status: 'running', metadata })
  // ... 250 more lines of UI logic
}

// NEW - Store raw event data
const sessionService = getSessionService()
sessionService.appendToNodeExecution({
  nodeId: nid,
  nodeLabel: getNodeLabel(nid),
  nodeKind: getNodeKind(nid),
  content: {
    type: 'event',
    event: {
      type: 'toolStart',
      toolName: ev.toolName,
      callId: ev.callId,
      toolArgs: ev.toolArgs,
      timestamp: Date.now()
    }
  }
})
```

**Remove from Main**:
- `formatToolName()` - Move to renderer
- `normalizeTool()` - Move to renderer
- `deriveFsReadLinesMeta()` - Move to renderer
- All `contentType` and `interactive` logic - Move to renderer
- Badge status/color logic - Move to renderer

**Keep in Main**:
- Text chunk buffering (performance optimization)
- Calling `SessionService.appendToNodeExecution()`
- Token usage tracking

#### B. Create Renderer Flow Event Processor

**File**: `src/services/flowEventProcessor.ts` (new)

```typescript
/**
 * Flow Event Processor - Renderer-side
 *
 * Subscribes to flow events and creates UI-specific badge objects
 */

export class FlowEventProcessor {
  private activeBadges = new Map<string, Badge>()

  processEvent(event: FlowEvent) {
    switch (event.type) {
      case 'toolStart':
        this.handleToolStart(event)
        break
      case 'toolEnd':
        this.handleToolEnd(event)
        break
      case 'toolError':
        this.handleToolError(event)
        break
    }
  }

  private handleToolStart(event: ToolStartEvent) {
    const badge: Badge = {
      id: event.callId,
      type: 'tool',
      label: this.formatToolName(event.toolName),
      status: 'running',
      timestamp: event.timestamp,
      metadata: this.deriveMetadata(event.toolName, event.toolArgs),
    }

    this.activeBadges.set(event.callId, badge)
    // Update UI state to show badge
  }

  private handleToolEnd(event: ToolEndEvent) {
    const badge = this.activeBadges.get(event.callId)
    if (!badge) return

    // Add expansion logic, content type, interactive data
    const updates = this.deriveToolEndUpdates(event.toolName, event.result, event.toolArgs)

    Object.assign(badge, {
      status: 'success',
      ...updates
    })

    // Update UI state
  }

  private formatToolName(toolName: string): string {
    // Move formatToolName logic here
  }

  private deriveMetadata(toolName: string, args: any): any {
    // Move all metadata derivation logic here
  }

  private deriveToolEndUpdates(toolName: string, result: any, args: any): any {
    // Move all contentType/interactive/expansion logic here
  }
}
```

**Estimated Effort**: 4-6 hours
- Simplify main event handlers: 2 hours
- Create renderer event processor: 2-3 hours
- Move ~260 lines of UI logic: 1 hour

---

### 3. Update SessionService to Subscribe to Flow Events ⏳ NOT STARTED

**File**: `electron/services/SessionService.ts`

**Purpose**: SessionService needs to listen to flow events for token tracking

**What to Add**:
```typescript
// In SessionService constructor or initialize()
import { flowEvents } from '../../ipc/flows-v2flow-engine/events.js'

flowEvents.on('broadcast', (event: any) => {
  if (event.type === 'tokenUsage') {
    this.recordTokenUsage({
      nodeId: event.nodeId,
      executionId: event.executionId,
      usage: event.usage,
      provider: event.provider,
      model: event.model,
    })
  }

  if (event.type === 'nodeEnd') {
    this.finalizeNodeUsage({
      nodeId: event.nodeId,
      executionId: event.executionId,
    })
  }

  if (event.type === 'done') {
    this.finalizeRequestUsage({
      requestId: event.requestId,
    })
  }
})
```

**Estimated Effort**: 1 hour

---

### 4. Remove Old Zustand Store and Slices ⏳ NOT STARTED

**Files to Remove**:
- `electron/store/index.ts` - Main store creation
- `electron/store/slices/*.ts` - All 15 slice files (8,500+ lines)
- `electron/store/utils/persistence.ts` - Old persistence helpers

**Files to Keep**:
- `electron/store/utils/session-persistence.ts` - Still used by SessionService
- `electron/store/utils/knowledgeBase.ts` - Utility functions
- `electron/store/utils/workspace-helpers.ts` - Utility functions

**Estimated Effort**: 30 minutes (delete files, verify no imports)

---

### 5. Update Service Registry ⏳ NOT STARTED

**File**: `electron/services/index.ts`

**What to Add**: Register all 18 services in the registry

```typescript
import { ServiceRegistry } from './base/ServiceRegistry.js'
import { DebugService } from './DebugService.js'
import { ViewService } from './ViewService.js'
// ... import all 18 services

// Register all services
ServiceRegistry.register('debug', new DebugService())
ServiceRegistry.register('view', new ViewService())
// ... register all 18 services

// Export getters
export const getDebugService = () => ServiceRegistry.get<DebugService>('debug')
export const getViewService = () => ServiceRegistry.get<ViewService>('view')
// ... export all 18 getters
```

**Estimated Effort**: 30 minutes

---

### 6. Create Comprehensive Tests ⏳ NOT STARTED

**Files**: `electron/services/__tests__/*.test.ts`

**Coverage Needed**:
- Unit tests for each service
- Integration tests for cross-service communication
- End-to-end tests for critical flows

**Estimated Effort**: 8-12 hours (comprehensive test suite)

---

### 7. Remove Zustand Dependencies ⏳ NOT STARTED

**File**: `package.json`

**Dependencies to Remove**:
- `zustand`
- `@zubridge/electron` (if still present)

**Estimated Effort**: 5 minutes

---

## Total Estimated Effort

- **Critical Path** (required for app to work): 8-11 hours
  - Update WebSocket handlers (2-3 hours)
  - Simplify flow event handlers in main (2 hours)
  - Create renderer flow event processor (2-3 hours)
  - Move badge creation logic to renderer (1 hour)
  - Subscribe SessionService to events (1 hour)

- **Cleanup** (nice to have): 2-3 hours
  - Remove old files (30 min)
  - Update service registry (30 min)
  - Remove dependencies (5 min)
  - Documentation updates (1 hour)

- **Testing** (important but can be done incrementally): 8-12 hours

**Total**: 18-26 hours of focused work

---

## Recommended Order

1. ✅ **Update Service Registry** (30 min) - Foundation for everything else
2. ✅ **Update WebSocket Handlers** (2-3 hours) - Critical for app functionality
3. ✅ **Simplify Flow Event Handlers in Main** (2 hours) - Remove UI logic, use SessionService
4. ✅ **Create Renderer Flow Event Processor** (2-3 hours) - Badge creation in renderer
5. ✅ **Subscribe SessionService to Flow Events** (1 hour) - Token tracking
6. ⏳ **Test End-to-End** (2 hours) - Verify everything works
7. ⏳ **Remove Old Files** (30 min) - Cleanup
8. ⏳ **Remove Dependencies** (5 min) - Final cleanup
9. ⏳ **Comprehensive Tests** (8-12 hours) - Can be done incrementally

---

## Success Criteria

- [ ] All WebSocket RPC handlers use services (no `useMainStore` calls)
- [ ] Flow events processed in renderer (no UI logic in main)
- [ ] SessionService tracks tokens via flow events
- [ ] All old Zustand files removed
- [ ] App runs without errors
- [ ] All features work as before
- [ ] Test coverage >80%

