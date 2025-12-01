# Loading Architecture Refactor

## Overview
Refactored the loading architecture to eliminate race conditions by using a deterministic, push-based event stream from main to renderer.

## New Flow

### 1. Window Creation & Listener Setup
```
App Launch / New Window
  ↓
Renderer spawns → gets windowId → sets up ALL listeners
  ↓
Renderer signals window.ready to main process
```

### 2. Main Process Loads & Streams Data
```
Main receives window.ready
  ↓
Main loads workspace (if one exists for this window)
  ↓
Main builds complete snapshot (sessions, flows, models, kanban, KB, etc.)
  ↓
Main streams events:
  - workspace.attached
  - workspace.snapshot (complete data)
  - workspace.ready
  - loading.complete
```

### 3. Renderer Receives & Updates
```
Renderer listens for events
  ↓
workspace.snapshot → hydrates all stores
  ↓
loading.complete → hides loading screen
```

## Key Changes

### Main Process
- **window.ready RPC**: New handler that receives signal from renderer when all listeners are ready
- **Snapshot includes everything**: Sessions, flows, models, kanban, KB items (not just counts)
- **loading.complete event**: Signals renderer that all data has been streamed

### Renderer
- **Removed pull-based hydration**: No more RPC calls to fetch data on mount
- **Removed fallback hydration**: No safety timeouts or retry logic needed
- **Simplified event handlers**: Just listen and update stores reactively
- **Loading screen driven by hydration store**: Uses phase-based state machine

### Files Modified
- `electron/backend/ws/handlers/misc-handlers.ts` - Added window.ready handler
- `electron/backend/ws/workspace-loader.ts` - Added loading.complete event
- `electron/backend/ws/snapshot.ts` - Include full KB items/files
- `shared/hydration.ts` - Updated WorkspaceSnapshot type
- `src/lib/backend/bootstrap.ts` - Signal window.ready after listeners setup
- `src/store/hydration.ts` - Handle loading.complete, hydrate KB from snapshot
- `src/store/sessionUi.ts` - Removed old hydration logic and fallbacks

## Benefits

1. **No race conditions**: Renderer is guaranteed ready before data flows
2. **Deterministic ordering**: Events arrive in predictable sequence
3. **Simpler code**: No complex request orchestration or retry logic
4. **Better multi-window support**: Each window independently signals readiness
5. **Eliminates loading screen timing hacks**: Loading screen stays until event stream completes
6. **All data loaded upfront**: No more lazy loading when switching screens

## Migration Notes

- Old hydration RPCs still exist but are unused (can be removed in future cleanup)
- hydrateSessionUiSettingsAndFlows() function still exported but not called during initial load
- ScreenLoader components may still exist but should be phased out in favor of snapshot-driven rendering

