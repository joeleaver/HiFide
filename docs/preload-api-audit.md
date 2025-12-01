# Preload API Audit - Unused APIs

**Date**: 2025-11-27  
**Status**: Analysis Complete

## Summary

Out of **17 APIs** exposed via `electron/preload.ts`, only **4 are actually used** in the renderer.

**13 APIs (76%) are completely unused and can be removed.**

---

## ✅ Used APIs (Keep These)

### 1. `window.wsBackend` ✅
**Usage**: 1 reference in `src/lib/backend/bootstrap.ts`
```typescript
const boot = window.wsBackend?.getBootstrap?.()
```
**Purpose**: WebSocket backend bootstrap (URL, token, windowId from query params)  
**Status**: **KEEP** - Critical for backend connection

### 2. `window.menu` ✅
**Usage**: 25 references in `src/hooks/useMenuHandlers.ts`
```typescript
window.menu.on('open-settings', menuHandlers.openSettings)
window.menu.on('open-session', menuHandlers.openSession)
// ... 23 more menu event handlers
```
**Purpose**: Menu event handling (File, Edit, View menus)  
**Status**: **KEEP** - Core UI functionality

### 3. `window.app` ✅
**Usage**: 1 reference in `src/services/appBridge.ts`
```typescript
await window.app?.setView?.(view as any)
```
**Purpose**: Notify main process of view changes  
**Status**: **KEEP** - Needed for menu state sync

### 4. `window.workspace` ✅
**Usage**: 20 references across multiple files
- `src/hooks/useMenuHandlers.ts` - folder operations
- `src/store/workspaceUi.ts` - workspace management
- `src/components/WelcomeScreen.tsx` - folder selection
- `src/App.tsx` - workspace initialization

**Purpose**: Workspace operations (get/set root, bootstrap, settings, file I/O)  
**Status**: **KEEP** - Core workspace functionality

---

## ❌ Unused APIs (Remove These)

### 5. `window.fs` ❌
**Usage**: 0 references  
**APIs**: getCwd, readFile, readDir, watchDir, unwatch, onWatch  
**Status**: **REMOVE** - Completely unused, likely superseded by WebSocket JSON-RPC

### 6. `window.sessions` ❌
**Usage**: 0 references  
**APIs**: list, load, save, delete  
**Status**: **REMOVE** - Session management now via WebSocket JSON-RPC

### 7. `window.capabilities` ❌
**Usage**: 0 references  
**APIs**: get  
**Status**: **REMOVE** - Capabilities now via WebSocket JSON-RPC

### 8. `window.agent` ❌
**Usage**: 0 references  
**APIs**: onMetrics  
**Status**: **REMOVE** - Metrics now via WebSocket JSON-RPC

### 9. `window.tsRefactor` ❌
**Usage**: 0 references  
**APIs**: rename, organizeImports  
**Status**: **REMOVE** - Never used in renderer

### 10. `window.tsRefactorEx` ❌
**Usage**: 0 references  
**APIs**: addExportNamed, moveFile  
**Status**: **REMOVE** - Never used in renderer

### 11. `window.tsExportUtils` ❌
**Usage**: 0 references  
**APIs**: ensureDefaultExport, addExportFrom  
**Status**: **REMOVE** - Never used in renderer

### 12. `window.tsTransform` ❌
**Usage**: 0 references  
**APIs**: suggestParams, extractFunction  
**Status**: **REMOVE** - Never used in renderer

### 13. `window.tsInline` ❌
**Usage**: 0 references  
**APIs**: inlineVariable, inlineFunction, defaultToNamed, namedToDefault  
**Status**: **REMOVE** - Never used in renderer

### 14. `window.edits` ❌
**Usage**: 0 references  
**APIs**: apply, propose  
**Status**: **REMOVE** - Edits now via WebSocket JSON-RPC

### 15. `window.indexing` ❌
**Usage**: 0 references  
**APIs**: rebuild, cancel, status, clear, search, onProgress  
**Status**: **REMOVE** - Indexing now via WebSocket JSON-RPC

### 16. `window.flowProfiles` ❌
**Usage**: 0 references  
**APIs**: get, set, list, delete, has  
**Status**: **REMOVE** - Flow profiles now via WebSocket JSON-RPC

### 17. `window.ratelimits` ❌
**Usage**: 0 references  
**APIs**: get, set  
**Status**: **REMOVE** - Rate limits now via WebSocket JSON-RPC

---

## Impact Analysis

### Code Reduction
- **Preload APIs to remove**: 13 (76%)
- **Lines to remove from preload.ts**: ~120 lines (54%)
- **IPC handlers to remove**: Multiple files in `electron/ipc/`
- **Type definitions to remove**: `src/types/preload.d.ts`

### Migration Pattern
Most of these APIs were replaced by **WebSocket JSON-RPC** architecture:
- Sessions, capabilities, agent metrics → WebSocket
- Indexing operations → WebSocket
- Flow profiles → WebSocket
- Rate limits → WebSocket
- Edits → WebSocket

### TypeScript Refactoring APIs
All 5 TypeScript refactoring APIs are unused:
- `tsRefactor` (2 methods)
- `tsRefactorEx` (2 methods)
- `tsExportUtils` (2 methods)
- `tsTransform` (2 methods)
- `tsInline` (4 methods)

**Total**: 12 unused TypeScript refactoring methods

These are fully implemented in `electron/refactors/ts.ts` but never called from the renderer.

---

## Recommendation

**Remove all 13 unused APIs** in a single cleanup pass:

1. Remove from `electron/preload.ts`
2. Remove corresponding IPC handlers
3. Remove type definitions from `src/types/preload.d.ts`
4. Consider removing unused implementations if not used elsewhere

**Estimated effort**: 30-45 minutes  
**Risk**: Very low (no renderer code uses these APIs)  
**Benefit**: Cleaner preload surface, reduced IPC complexity

