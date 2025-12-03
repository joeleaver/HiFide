# WebSocket Architecture - Clean Separation of Concerns

## Core Principle

**ZERO React components subscribe directly to WebSocket events.**

All WebSocket subscriptions go through Zustand stores via `init*Events()` functions that are called once at app startup.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Electron)                  │
│  - Owns canonical state                                      │
│  - Broadcasts notifications via WebSocket JSON-RPC           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket JSON-RPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   BackendClient (Renderer)                   │
│  - Single WebSocket connection per window                   │
│  - Manages subscriptions and reconnection                   │
│  - Wraps vscode-jsonrpc MessageConnection                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ client.subscribe()
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Store init*Events() Functions                   │
│  - Called ONCE at app startup (bootstrap.ts)                │
│  - Subscribe to WebSocket notifications                      │
│  - Update Zustand store state                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Zustand state updates
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   React Components                           │
│  - Read from stores using selectors                         │
│  - NEVER call client.subscribe()                            │
│  - Reactive updates via Zustand                             │
└─────────────────────────────────────────────────────────────┘
```

## Stores and Their Responsibilities

| Store | File | WebSocket Events | Purpose |
|-------|------|------------------|---------|
| chatTimeline | `src/store/chatTimeline.ts` | `session.timeline.delta`, `session.timeline.snapshot`, `session.selected` | Timeline items and deltas |
| sessionUi | `src/store/sessionUi.ts` | `session.selected`, `session.list.changed`, `settings.models.changed`, `workspace.ready` | Session list and selection |
| flowContexts | `src/store/flowContexts.ts` | `flow.contexts.changed` | Flow execution contexts + request metadata |
| flowRuntime | `src/store/flowRuntime.ts` | Via FlowService.onEvent() | Flow execution state |
| workspaceUi | `src/store/workspaceUi.ts` | `workspace.bound`, `workspace.ready` | Workspace state |
| knowledgeBase | `src/store/knowledgeBase.ts` | `kb.items.changed`, `kb.files.changed` | KB items and files |
| kanban | `src/store/kanban.ts` | `kanban.board.changed` | Kanban board state |
| appBoot | `src/store/appBoot.ts` | `app.boot.changed` | App boot status |
| terminalTabs | `src/store/terminalTabs.ts` | `terminal.tabs.changed`, `workspace.bound`, `workspace.ready` | Terminal tabs state |
| flowEditor | `src/store/flowEditor.ts` | `flowEditor.graph.changed` | Flow templates and graph version |

## Subscription Lifecycle

1. **App Startup** (`src/lib/backend/bootstrap.ts`):
   ```typescript
   // Initialize all event subscriptions ONCE
   initFlowRuntimeEvents()
   initChatTimelineEvents()
   initSessionUiEvents()
   initFlowContextsEvents()
   initWorkspaceUiEvents()
   initKnowledgeBaseEvents()
   initKanbanEvents()
   initAppBootEvents()
   initTerminalTabsEvents()
   initFlowEditorEvents()
   
   // Then connect
   client.connect()
   ```

2. **Reconnection**: BackendClient automatically re-attaches all subscriptions on reconnect

3. **No Cleanup**: Subscriptions persist for the lifetime of the app

## Component Patterns

### ✅ CORRECT - Read from store
```typescript
import { useKnowledgeBase } from '@/store/knowledgeBase'

function MyComponent() {
  const items = useKnowledgeBase((s) => s.itemsMap)
  const reloadIndex = useKnowledgeBase((s) => s.reloadIndex)
  
  useEffect(() => {
    reloadIndex()
  }, [reloadIndex])
  
  return <div>{Object.keys(items).length} items</div>
}
```

### ❌ WRONG - Subscribe directly
```typescript
// NEVER DO THIS!
function MyComponent() {
  const [items, setItems] = useState({})
  
  useEffect(() => {
    const client = getBackendClient()
    const unsub = client.subscribe('kb.items.changed', (p) => {
      setItems(p?.items || {})
    })
    return () => unsub()
  }, [])
}
```

## Benefits

1. **No Duplicate Subscriptions**: Each event has exactly one handler
2. **Automatic Reconnection**: BackendClient handles reconnection transparently
3. **Clean Separation**: Components are pure, stores handle side effects
4. **Easy Debugging**: All subscriptions in one place (bootstrap.ts)
5. **Consistent State**: Single source of truth in stores
6. **No Memory Leaks**: No manual cleanup needed

## Migration Checklist

When adding a new WebSocket event:

1. ✅ Create or update a store in `src/store/`
2. ✅ Add `init*Events()` function to the store
3. ✅ Call `init*Events()` in `bootstrap.ts`
4. ✅ Components read from store using selectors
5. ✅ NEVER call `client.subscribe()` in components

