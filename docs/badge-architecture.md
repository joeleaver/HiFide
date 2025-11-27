# Badge Architecture - Correct Separation of Concerns

## Problem Statement

The current implementation has **~260 lines of UI-specific badge creation logic in the main process** (`electron/flow-engine/index.ts` lines 308-570). This violates separation of concerns:

- **Main process** should emit semantic, raw event data
- **Renderer** should handle all UI-specific formatting and presentation

## Current (Incorrect) Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Main Process                                                    │
│                                                                 │
│  Scheduler                                                      │
│     │                                                           │
│     ├─> Raw Event: { type: 'toolStart', toolName, args }       │
│     │                                                           │
│     v                                                           │
│  Event Handler (electron/flow-engine/index.ts)                │
│     │                                                           │
│     ├─> formatToolName() ❌ UI logic                            │
│     ├─> normalizeTool() ❌ UI logic                             │
│     ├─> deriveFsReadLinesMeta() ❌ UI logic                     │
│     ├─> Determine contentType ❌ UI logic                       │
│     ├─> Setup interactive data ❌ UI logic                      │
│     │                                                           │
│     v                                                           │
│  Badge Object: {                                                │
│    id, type: 'tool', label: 'FS Read Lines',                   │
│    status: 'running', expandable: true,                        │
│    contentType: 'read-lines',                                  │
│    metadata: { filePath, startLine, endLine },                 │
│    interactive: { type: 'read-lines', data: { key } }          │
│  }                                                              │
│     │                                                           │
│     v                                                           │
│  Session Timeline (Zustand Store)                              │
│     │                                                           │
│     v                                                           │
│  WebSocket → Renderer                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Renderer                                                        │
│                                                                 │
│  Receives pre-formatted badge objects                          │
│     │                                                           │
│     v                                                           │
│  <ToolBadgeContainer badge={badge}>                            │
│    {/* Just displays what main process created */}             │
│  </ToolBadgeContainer>                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Problem**: Main process is doing UI work (formatting, metadata extraction, expansion logic)

---

## Correct Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Main Process                                                    │
│                                                                 │
│  Scheduler                                                      │
│     │                                                           │
│     ├─> Raw Event: {                                           │
│     │     type: 'toolStart',                                   │
│     │     toolName: 'fs.read_lines',                           │
│     │     callId: 'abc123',                                    │
│     │     toolArgs: { path: 'foo.ts', start_line: 10 },       │
│     │     timestamp: 1234567890                                │
│     │   }                                                       │
│     │                                                           │
│     v                                                           │
│  SessionService                                                 │
│     │                                                           │
│     ├─> appendToNodeExecution({                                │
│     │     nodeId, nodeLabel, nodeKind,                         │
│     │     content: {                                           │
│     │       type: 'event',                                     │
│     │       event: { /* raw event data */ }                    │
│     │     }                                                     │
│     │   })                                                      │
│     │                                                           │
│     v                                                           │
│  Session Timeline (stores raw events)                          │
│     │                                                           │
│     v                                                           │
│  WebSocket → Renderer (raw events)                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Renderer                                                        │
│                                                                 │
│  FlowEventProcessor                                             │
│     │                                                           │
│     ├─> Receives raw event                                     │
│     │                                                           │
│     ├─> formatToolName() ✅ UI logic in renderer               │
│     ├─> normalizeTool() ✅ UI logic in renderer                │
│     ├─> deriveFsReadLinesMeta() ✅ UI logic in renderer        │
│     ├─> Determine contentType ✅ UI logic in renderer          │
│     ├─> Setup interactive data ✅ UI logic in renderer         │
│     │                                                           │
│     v                                                           │
│  Badge Object: {                                                │
│    id, type: 'tool', label: 'FS Read Lines',                   │
│    status: 'running', expandable: true,                        │
│    contentType: 'read-lines',                                  │
│    metadata: { filePath, startLine, endLine },                 │
│    interactive: { type: 'read-lines', data: { key } }          │
│  }                                                              │
│     │                                                           │
│     v                                                           │
│  Local UI State (Zustand/React)                                │
│     │                                                           │
│     v                                                           │
│  <ToolBadgeContainer badge={badge}>                            │
│    {/* Renders badge created in renderer */}                   │
│  </ToolBadgeContainer>                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits**: 
- Main process only handles business logic
- Renderer owns all presentation logic
- Clean separation of concerns

---

## Migration Plan

### Step 1: Simplify Main Process Event Handlers

**File**: `electron/flow-engine/index.ts`

**Remove** (~260 lines of UI logic):
- `formatToolName()`
- `normalizeTool()`
- `deriveFsReadLinesMeta()`
- All `contentType` logic
- All `interactive` data setup
- All `metadata` extraction

**Replace with**:
```typescript
if (t === 'toolStart' && nid) {
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
}
```

### Step 2: Create Renderer Flow Event Processor

**File**: `src/services/flowEventProcessor.ts` (new)

Move all UI logic here:
- Badge creation from raw events
- Tool name formatting
- Metadata derivation
- Content type determination
- Interactive data setup

### Step 3: Update SessionService

**File**: `electron/services/SessionService.ts`

Update `appendToNodeExecution` to accept raw event data:
```typescript
content: 
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'event'; event: RawFlowEvent }  // ← New
```

---

## Benefits

1. **Separation of Concerns**: Main = business logic, Renderer = UI logic
2. **Easier Testing**: UI logic can be tested in renderer without main process
3. **Better Performance**: Renderer can optimize badge rendering without IPC
4. **Cleaner Code**: Each layer has clear responsibilities
5. **Flexibility**: UI can change badge format without touching main process

