# Preload Bridge Complete Elimination

**Date**: 2025-11-27  
**Status**: Complete

## Summary

Successfully eliminated **ALL** preload APIs except `window.menu`, reducing the preload bridge from **17 APIs to 1 API (94% reduction)**.

---

## Final State

### Remaining API (1 out of 17)
✅ **`window.menu`** - Menu event handling (OS integration, cannot be done via WebSocket)

### Removed APIs (16 out of 17)

**Phase 1 - Unused APIs (13)**:
1. ❌ `window.fs.*` - File system operations
2. ❌ `window.sessions.*` - Session management
3. ❌ `window.capabilities.*` - Provider capabilities
4. ❌ `window.agent.*` - Agent metrics
5. ❌ `window.tsRefactor*` - TypeScript refactoring (5 APIs)
6. ❌ `window.edits.*` - Edit operations
7. ❌ `window.indexing.*` - Indexing operations
8. ❌ `window.flowProfiles.*` - Flow profiles
9. ❌ `window.ratelimits.*` - Rate limits

**Phase 2 - Bad Patterns (2)**:
14. ❌ `window.wsBackend` - Unnecessary preload for query params
15. ❌ `window.app.setView` - Circular no-op pattern

**Phase 3 - Workspace API Migration (1)**:
16. ❌ `window.workspace.*` - All 11 methods migrated to WebSocket RPC

---

## Phase 3 Details: Workspace API Migration

### What Was Removed

All 11 `window.workspace` methods:
- `getRoot()` → `workspace.get` RPC
- `setRoot(newRoot)` → `workspace.open` RPC
- `openFolderDialog()` → `workspace.openFolderDialog` RPC ✨
- `notifyRecentFoldersChanged()` → Not needed
- `bootstrap()` → Unused
- `ensureDirectory()` → Unused
- `getSettings()` → `workspace.getSettings` RPC ✨
- `setSetting(key, value)` → `workspace.setSetting` RPC ✨
- `fileExists()` → Unused (security risk)
- `readFile()` → Unused (security risk)
- `writeFile()` → Unused (security risk)
- `listFiles()` → Unused (security risk)

### New WebSocket RPC Handlers

Added 3 new RPC methods in `electron/backend/ws/server.ts`:

1. **`workspace.openFolderDialog`** - Opens native folder picker
   ```typescript
   const result = await client.rpc('workspace.openFolderDialog', {})
   // Returns: { ok: true, path: '/path/to/folder' } or { ok: false, canceled: true }
   ```

2. **`workspace.getSettings`** - Get workspace-specific settings
   ```typescript
   const result = await client.rpc('workspace.getSettings', {})
   // Returns: { ok: true, settings: { layout: {...}, ... } }
   ```

3. **`workspace.setSetting`** - Set workspace-specific setting
   ```typescript
   await client.rpc('workspace.setSetting', { key: 'layout', value: {...} })
   // Returns: { ok: true }
   ```

### Renderer Code Updated

**Files modified (6)**:
1. `src/hooks/useMenuHandlers.ts` - Open folder handler
2. `src/components/StatusBar.tsx` - Folder picker button
3. `src/components/WelcomeScreen.tsx` - Open folder dialog
4. `src/components/ActivityBar.tsx` - Layout persistence (14 instances)
5. `src/components/GlobalSessionPanel.tsx` - Layout persistence (2 instances)
6. `src/App.tsx` - Layout hydration (1 instance)

**Total usages migrated**: 20 references

---

## Code Metrics

### Preload Bridge
- **electron/preload.ts**: 222 lines → 83 lines (**63% reduction**, -139 lines)
- **APIs exposed**: 17 → 1 (**94% reduction**)
- **Only `window.menu` remains**

### Type Definitions
- **src/types/preload.d.ts**: 147 lines → 34 lines (**77% reduction**, -113 lines)
- Comprehensive documentation of removed APIs

### Files Deleted
- `src/services/appBridge.ts`
- `electron/services/appBridge.ts`

### WebSocket RPC
- **Added 3 new workspace RPC handlers**
- **All workspace operations now via WebSocket**

---

## Security Benefits

✅ **Eliminated direct file I/O from renderer** - Removed `fileExists`, `readFile`, `writeFile`, `listFiles`  
✅ **Reduced IPC attack surface by 94%** - Only 1 API remains  
✅ **All business logic via WebSocket** - Auditable, secure, consistent  
✅ **Preload only for OS integration** - Native dialogs and menus  

---

## Architecture Benefits

✅ **WebSocket-first architecture** - All operations via RPC  
✅ **Consistent API surface** - No mixing of IPC and WebSocket  
✅ **Better separation of concerns** - Preload for OS, WebSocket for logic  
✅ **Easier to maintain** - Single communication pattern  
✅ **Better testability** - RPC handlers are easier to test than IPC  

---

## Migration Summary

| Phase | APIs Removed | Reason | Time |
|---|---|---|---|
| Phase 1 | 13 | Unused (migration debt) | ~1 hour |
| Phase 2 | 2 | Bad patterns | ~30 min |
| Phase 3 | 1 (11 methods) | Migrate to WebSocket | ~1 hour |
| **Total** | **16 (94%)** | | **~2.5 hours** |

---

## Final Preload Bridge

```typescript
// electron/preload.ts (83 lines, down from 222)

// Menu API (only remaining preload API)
contextBridge.exposeInMainWorld('menu', {
  popup: (args: { menu: string; x: number; y: number }) => 
    ipcRenderer.invoke('menu:popup', args),
  on: (name: string, listener: (payload?: any) => void) => {
    const handler = (_: any, payload: any) => listener(payload)
    ipcRenderer.on(`menu:${name}`, handler)
    return () => ipcRenderer.removeListener(`menu:${name}`, handler)
  },
  off: (name: string, listener: (payload?: any) => void) => {
    ipcRenderer.removeListener(`menu:${name}`, listener)
  },
})
```

---

## Conclusion

Successfully eliminated **94% of the preload bridge** (16 out of 17 APIs), leaving only `window.menu` for OS integration.

**Key achievements**:
- ✅ Removed all file I/O security risks
- ✅ Migrated all workspace operations to WebSocket RPC
- ✅ Eliminated bad patterns (wsBackend, app.setView)
- ✅ Cleaned up migration debt (13 unused APIs)
- ✅ Reduced preload from 222 lines to 83 lines
- ✅ Simplified type definitions from 147 lines to 34 lines

**The preload bridge is now minimal, secure, and maintainable!** 🎉

