# Flow Services Architecture

## Problem

The original `flowEditor.slice.ts` was a **3,322-line monolith** that violated separation of concerns:

1. **Mixed UI and business logic** - 700+ lines of badge rendering/UI payload logic in main process
2. **God Object anti-pattern** - 5-7 distinct responsibilities in one file
3. **Tight coupling** - Scheduler, UI state, configuration, profiles all tangled together

## Solution

Split the monolith into **focused services** with clear separation between main process (business logic) and renderer (UI logic).

---

## New Architecture

### Main Process Services (Business Logic Only)

#### 1. FlowExecutionService
**Responsibility**: Flow execution lifecycle

- Start/stop/resume flows
- Track execution state (running/stopped/waitingForInput)
- Manage active scheduler instances
- Resolve user input promises
- Provide execution snapshots for reconnection

**Key Methods**:
- `startFlow()` - Start flow execution, returns requestId
- `stopFlow()` - Stop current flow
- `resumeFlow()` - Resume with user input
- `waitForUserInput()` - Wait for user input at a node
- `handleFlowDone()` - Handle flow completion
- `handleFlowError()` - Handle flow error
- `getSnapshot()` - Get execution state for UI

**State**: Transient (no persistence)

---

#### 2. FlowProfileService
**Responsibility**: Template and profile management

- Load flow templates from system/user/workspace libraries
- Save flow profiles to user/workspace libraries
- Delete flow profiles
- Import/export flows
- Track available templates

**Key Methods**:
- `initialize()` - Load all available templates
- `loadTemplate()` - Load a specific template
- `saveProfile()` - Save flow as profile
- `deleteProfile()` - Delete a profile
- `exportFlow()` - Export flow to file
- `importFlow()` - Import flow from file

**State**: Transient (no persistence)

---

#### 3. FlowConfigService
**Responsibility**: Flow execution configuration

- Retry settings (attempts, backoff)
- Cache settings
- Redactor rules (emails, API keys, AWS keys)
- Budget limits
- Error detection patterns
- Portal data cache

**Key Methods**:
- `setRetryAttempts()`, `setRetryBackoffMs()`
- `setCacheEnabled()`
- `setRedactorEnabled()`, `setRuleEmails()`, `setRuleApiKeys()`, `setRuleAwsKeys()`
- `setBudgetUSD()`, `setBudgetBlock()`
- `setErrorDetectEnabled()`, `setErrorDetectBlock()`, `setErrorDetectPatterns()`
- `setPortalData()`, `getPortalData()`, `clearPortalData()`

**State**: Transient (could be persisted per-flow in future)

---

#### 4. FlowGraphService
**Responsibility**: Store last-saved graph for scheduler

- Store committed graph (nodes/edges)
- Provide graph to scheduler for execution
- Handle node label/config updates

**Key Methods**:
- `setGraph()` - Set committed graph (called when user saves)
- `getGraph()` - Get graph for scheduler
- `setNodeLabel()`, `patchNodeConfig()`
- `setSelectedNodeId()`

**State**: Transient (graphs persisted as flow profiles)

**NOTE**: The renderer owns the live editing state. This is just a snapshot.

---

### Renderer (UI Logic)

#### Local Flow Editor Store (Renderer-only Zustand)
- Graph editing (nodes/edges/positions)
- Drag/drop/resize
- Selection state
- Undo/redo
- Dirty state tracking

#### Flow Event Processor (Renderer)
- Receives flow events via WebSocket
- Renders badges (tool execution, intents, etc.)
- Updates UI state
- Handles streaming text

#### Flow Timeline Renderer (Renderer)
- Displays execution history
- Shows node execution boxes
- Renders tool badges with diff editors
- Handles expandable content

---

## Event Flow

```
┌─────────────┐
│  Scheduler  │
└──────┬──────┘
       │
       │ emitFlowEvent()
       ▼
┌─────────────────┐
│  FlowEvents     │ (EventEmitter)
│  (broadcast)    │
└──────┬──────────┘
       │
       ├──────────────────────┐
       │                      │
       ▼                      ▼
┌──────────────┐      ┌──────────────┐
│ SessionService│      │  WebSocket   │
│ (token track) │      │   Server     │
└───────────────┘      └──────┬───────┘
                              │
                              │ JSON-RPC notification
                              ▼
                       ┌──────────────┐
                       │   Renderer   │
                       │ (UI updates) │
                       └──────────────┘
```

**Key Points**:
- Scheduler emits events via `emitFlowEvent()`
- Events broadcast to both SessionService (for token tracking) and WebSocket
- WebSocket forwards to renderer via JSON-RPC notifications
- Renderer processes events and updates UI
- **NO UI logic in main process**

---

## What Was Removed from Main Process

### ❌ Removed (Moved to Renderer)

1. **Badge Creation Logic** (~260 lines from `electron/flow-engine/index.ts`)
   - Tool name formatting (`formatToolName`)
   - Tool normalization (`normalizeTool`)
   - Metadata derivation (`deriveFsReadLinesMeta`, etc.)
   - Content type determination (diff, search, read-lines, etc.)
   - Interactive data setup (expansion, preview keys)
   - Badge status/color logic

2. **Flow Graph Visual State** (~300 lines from `flowEditor.slice.ts`)
   - Node colors/borders
   - Status indicators
   - Error highlighting
   - Active node tracking

**Total Removed**: ~560 lines of UI logic moved to renderer

### ✅ Kept in Main Process (Business Logic)

1. **Session Timeline Management** (SessionService)
   - Store raw event data (not UI-formatted badges)
   - Text chunk buffering (performance optimization)
   - Token usage tracking
   - Node execution box lifecycle

2. **Flow Execution** (FlowExecutionService)
   - Start/stop/resume flows
   - Execution state tracking
   - User input promises

3. **Flow Configuration** (FlowConfigService, FlowProfileService)
   - Retry/cache/redactor settings
   - Template/profile management

4. **Graph Storage** (FlowGraphService)
   - Last-saved graph for scheduler

---

## Benefits

1. **Separation of Concerns**
   - Business logic in main process
   - UI logic in renderer
   - Clear boundaries

2. **Reduced Complexity**
   - 3,322 lines → ~800 lines across 4 focused services
   - Each service has single responsibility

3. **Better Performance**
   - No IPC churn for UI updates
   - Renderer handles UI reactivity locally

4. **Easier Testing**
   - Services are independent
   - No UI dependencies in business logic

5. **Maintainability**
   - Clear ownership
   - Easy to find code
   - Simple to extend

---

## Migration Status

✅ **Completed**:
- FlowExecutionService (249 lines)
- FlowProfileService (320 lines)
- FlowConfigService (185 lines)
- FlowGraphService (120 lines)

⏳ **Next Steps**:
1. Update WebSocket JSON-RPC handlers to use new services
2. Create renderer-side flow event processor
3. Move badge rendering logic to renderer
4. Update SessionService to subscribe to flow events for token tracking
5. Remove old flowEditor.slice.ts
6. Update tests

---

## File Locations

**Main Process**:
- `electron/services/FlowExecutionService.ts`
- `electron/services/FlowProfileService.ts`
- `electron/services/FlowConfigService.ts`
- `electron/services/FlowGraphService.ts`

**Renderer** (to be created):
- `src/store/flowEditor.ts` - Local editing state
- `src/services/flowEventProcessor.ts` - Event handling and badge rendering
- `src/components/FlowTimeline.tsx` - Timeline rendering

