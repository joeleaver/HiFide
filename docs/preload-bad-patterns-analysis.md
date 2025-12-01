# Preload Bad Patterns Analysis

**Date**: 2025-11-27  
**Status**: Analysis Complete

## Summary

Both `window.wsBackend` and `window.app` are **legacy patterns that should be removed**:

1. **`window.wsBackend`** - Unnecessarily uses preload bridge for data that's already available in the renderer
2. **`window.app.setView`** - Calls a no-op function in main process; completely redundant

---

## 1. `window.wsBackend` - Unnecessary Preload Bridge

### Current Implementation

**Preload** (`electron/preload.ts:12-26`):
```typescript
contextBridge.exposeInMainWorld('wsBackend', {
  getBootstrap: () => {
    const search = typeof location !== 'undefined' ? location.search : ''
    const params = new URLSearchParams(search || '')
    return {
      url: params.get('wsUrl') || '',
      token: params.get('wsToken') || '',
      windowId: params.get('windowId') || ''
    }
  }
})
```

**Usage** (`src/lib/backend/bootstrap.ts:25`):
```typescript
const boot = window.wsBackend?.getBootstrap?.()
if (!boot || !boot.url) return
```

### The Problem

**The preload bridge is completely unnecessary!** The function just reads `location.search` which is **already available in the renderer**:

```typescript
// Current (unnecessary preload):
const boot = window.wsBackend?.getBootstrap?.()

// Direct (no preload needed):
const params = new URLSearchParams(location.search)
const boot = {
  url: params.get('wsUrl') || '',
  token: params.get('wsToken') || '',
  windowId: params.get('windowId') || ''
}
```

### Why It Exists

This pattern was likely created when:
1. Someone thought query params needed to be "exposed" via preload
2. Or it was copied from a pattern where preload actually provided main-process data

But `location.search` is a standard browser API available in any renderer without needing preload!

### Recommendation

**Remove `window.wsBackend` entirely** and read query params directly in `bootstrap.ts`.

---

## 2. `window.app.setView` - Calls a No-Op

### Current Implementation

**Preload** (`electron/preload.ts:68-70`):
```typescript
contextBridge.exposeInMainWorld('app', {
  setView: (view: string) => ipcRenderer.invoke('app:set-view', view),
})
```

**IPC Handler** (`electron/ipc/menu.ts:178-181`):
```typescript
ipc.handle('app:set-view', (_event, view: ViewType) => {
  setCurrentViewForMenu(view)
  buildMenu()
})
```

**Renderer Usage** (`src/services/appBridge.ts:1-7`):
```typescript
export async function setAppView(view: string): Promise<void> {
  try {
    await window.app?.setView?.(view as any)
  } catch {
    // ignore
  }
}
```

**Main Process** (`electron/services/ViewService.ts:44-48`):
```typescript
// Also notify the main process (for menu updates, etc.)
try {
  void setAppView(view)
} catch (e) {
  console.error('[ViewService] Failed to call setAppView:', e)
}
```

**Main Process Stub** (`electron/services/appBridge.ts:7-9`):
```typescript
export async function setAppView(_view: string): Promise<void> {
  // No-op in main process - view changes are handled through the store
}
```

### The Problem

**This is a circular no-op!**

1. `ViewService.setView()` (main) calls `setAppView(view)` (main)
2. `setAppView()` (main) is a **no-op stub** that does nothing
3. The IPC handler `app:set-view` calls `setCurrentViewForMenu()` which updates a local variable
4. But `ViewService` already handles view changes properly via WebSocket RPC!

### The Real Flow

**Correct flow (via WebSocket RPC)**:
```
Renderer → client.rpc('view.set', { view }) → ViewService.setView() → setState() → onStateChange() → emit('view:changed')
```

**Redundant flow (via IPC)**:
```
ViewService.setView() → setAppView() → [no-op] ❌
```

### Why It Exists

This is **migration debt** from the Zustand removal:
1. Old pattern: renderer called `window.app.setView()` to sync menu state
2. New pattern: WebSocket RPC `view.set` handles everything
3. But the old IPC handler and preload exposure were never removed

### Recommendation

**Remove `window.app` entirely**:
1. Remove preload exposure
2. Remove IPC handler `app:set-view`
3. Remove `electron/services/appBridge.ts` (no-op stub)
4. Remove call to `setAppView()` in `ViewService.setView()`
5. Menu state should be synced via `view:changed` event or WebSocket notification

---

## Impact of Removing Both APIs

### Code Reduction
- **Preload**: Remove 2 API exposures (~20 lines)
- **IPC handlers**: Remove 1 handler (~5 lines)
- **Services**: Remove 2 files (`src/services/appBridge.ts`, `electron/services/appBridge.ts`)
- **Type definitions**: Remove 2 API types

### Benefits
- ✅ Cleaner preload with only essential APIs (menu, workspace)
- ✅ Eliminates unnecessary IPC round-trips
- ✅ Removes circular no-op pattern
- ✅ Simplifies bootstrap code
- ✅ Better alignment with WebSocket-first architecture

### Risk
- **Very low** - Both patterns are either redundant or no-ops

---

## Recommended Changes

### 1. Remove `window.wsBackend`

**Before** (`src/lib/backend/bootstrap.ts`):
```typescript
export function bootstrapBackendFromPreload(): void {
  const boot = window.wsBackend?.getBootstrap?.()
  if (!boot || !boot.url) return
  
  client = new BackendClient({
    url: boot.url,
    token: boot.token,
    // ...
  })
}
```

**After**:
```typescript
export function bootstrapBackend(): void {
  // Read query params directly (no preload needed!)
  const params = new URLSearchParams(location.search)
  const url = params.get('wsUrl') || ''
  const token = params.get('wsToken') || ''
  const windowId = params.get('windowId') || ''
  
  if (!url) return
  
  client = new BackendClient({
    url,
    token,
    // ...
  })
}
```

### 2. Remove `window.app.setView`

**Remove from `ViewService.setView()`**:
```typescript
setView(view: ViewType): void {
  if (this.state.currentView === view) return
  this.setState({ currentView: view })
  
  // REMOVE THIS:
  // try {
  //   void setAppView(view)
  // } catch (e) {
  //   console.error('[ViewService] Failed to call setAppView:', e)
  // }
}
```

**Update menu sync** to use `view:changed` event or WebSocket notification instead.

---

## Conclusion

Both APIs are **bad patterns** that should be removed:
- `window.wsBackend` - Unnecessary abstraction over standard browser API
- `window.app.setView` - Circular no-op from migration debt

Removing them will reduce preload surface to just **2 essential APIs**: `menu` and `workspace`.

