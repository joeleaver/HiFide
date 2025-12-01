# window.workspace Preload API Analysis

**Date**: 2025-11-27  
**Status**: Analysis Complete

## Summary

The `window.workspace` API exposes **11 methods** via preload, but analysis shows:
- **Only 1 method is actually used**: `openFolderDialog()` (3 usages)
- **10 methods are completely unused** in the renderer
- **Most functionality already available via WebSocket RPC**

---

## Current API Surface

### Exposed Methods (11 total)

1. ✅ **`openFolderDialog()`** - Opens native folder picker dialog (3 usages)
2. ❌ **`getRoot()`** - Get workspace root (0 usages)
3. ❌ **`setRoot(newRoot)`** - Set workspace root (0 usages)
4. ❌ **`notifyRecentFoldersChanged(folders)`** - Notify recent folders (0 usages)
5. ❌ **`bootstrap(baseDir, preferAgent, overwrite)`** - Bootstrap workspace (0 usages)
6. ❌ **`ensureDirectory(dirPath)`** - Ensure directory exists (0 usages)
7. ❌ **`getSettings()`** - Get workspace settings (0 usages)
8. ❌ **`setSetting(key, value)`** - Set workspace setting (0 usages)
9. ❌ **`fileExists(filePath)`** - Check file existence (0 usages)
10. ❌ **`readFile(filePath)`** - Read file content (0 usages)
11. ❌ **`writeFile(filePath, content)`** - Write file content (0 usages)
12. ❌ **`listFiles(dirPath)`** - List directory files (0 usages)

---

## Usage Analysis

### Actually Used (1 method)

**`openFolderDialog()` - 3 usages:**

1. **`src/components/WelcomeScreen.tsx:126`**
   ```typescript
   const result = await window.workspace?.openFolderDialog?.()
   if (result?.ok && result.path) {
     await client.rpc('workspace.open', { root: result.path })
   }
   ```

2. **`src/hooks/useMenuHandlers.ts:33`**
   ```typescript
   const result = await window.workspace?.openFolderDialog?.()
   if (result?.ok && result.path) {
     await client.rpc('workspace.open', { root: result.path })
   }
   ```

3. **`src/components/StatusBar.tsx:46`**
   ```typescript
   const result = await window.workspace?.openFolderDialog?.()
   if (result?.ok && result.path) {
     await client.rpc('workspace.open', { root: result.path })
   }
   ```

**Pattern**: All 3 usages follow the same pattern:
1. Call `window.workspace.openFolderDialog()` to get folder path from native dialog
2. Then call `client.rpc('workspace.open', { root })` via WebSocket to actually open it

---

## WebSocket RPC Equivalents

Most workspace operations are **already available via WebSocket RPC**:

### Workspace Operations
- ✅ `workspace.open` - Open workspace folder
- ✅ `workspace.get` - Get current workspace info
- ✅ `workspace.listRecentFolders` - List recent folders
- ✅ `explorer.getState` - Get workspace root and explorer state

### Settings Operations
- ✅ `settings.get` - Get all settings (includes workspace settings)
- ✅ `settings.setApiKeys` - Set API keys
- ✅ `settings.saveKeys` - Save settings

### File Operations
**Not available via WebSocket** - but also **not used** in renderer!

---

## Problems Identified

### 1. Unused File I/O Methods (4 methods)

These expose **direct file system access** from renderer but are **never used**:
- `fileExists(filePath)` - 0 usages
- `readFile(filePath)` - 0 usages
- `writeFile(filePath, content)` - 0 usages
- `listFiles(dirPath)` - 0 usages

**Security Risk**: Exposing raw file I/O to renderer is a security anti-pattern.  
**Recommendation**: Remove entirely (unused and risky).

### 2. Redundant Workspace Methods (3 methods)

Already available via WebSocket RPC:
- `getRoot()` - Use `workspace.get` RPC instead
- `setRoot(newRoot)` - Use `workspace.open` RPC instead
- `notifyRecentFoldersChanged()` - Not needed (main process manages this)

**Recommendation**: Remove (redundant with WebSocket RPC).

### 3. Unused Bootstrap/Settings Methods (3 methods)

- `bootstrap(baseDir, preferAgent, overwrite)` - 0 usages
- `ensureDirectory(dirPath)` - 0 usages
- `getSettings()` - Use `settings.get` RPC instead
- `setSetting(key, value)` - Use `settings.*` RPCs instead

**Recommendation**: Remove (unused or redundant).

### 4. Only Essential Method: `openFolderDialog()`

This is the **only method that should remain** because:
- ✅ Actually used (3 locations)
- ✅ Requires native OS dialog (can't be done via WebSocket)
- ✅ Legitimate use case for preload bridge

---

## Recommendation

**Remove 10 out of 11 methods**, keeping only `openFolderDialog()`:

### Keep (1 method)
```typescript
contextBridge.exposeInMainWorld('workspace', {
  openFolderDialog: () => ipcRenderer.invoke('workspace:open-folder-dialog'),
})
```

### Remove (10 methods)
- `getRoot`, `setRoot` - Use WebSocket RPC
- `notifyRecentFoldersChanged` - Not needed
- `bootstrap`, `ensureDirectory` - Unused
- `getSettings`, `setSetting` - Use WebSocket RPC
- `fileExists`, `readFile`, `writeFile`, `listFiles` - Unused and risky

---

## Impact

### Code Reduction
- **Preload methods**: 11 → 1 (91% reduction)
- **IPC handlers**: Remove 10 handlers from `electron/ipc/workspace.ts`
- **Type definitions**: Simplify to single method

### Security Benefits
- ✅ Removes direct file I/O access from renderer
- ✅ Reduces IPC attack surface by 91%
- ✅ Forces all workspace operations through WebSocket (auditable, secure)

### Architecture Benefits
- ✅ Aligns with WebSocket-first architecture
- ✅ Preload only for OS integration (native dialogs)
- ✅ All business logic via WebSocket RPC

---

## Migration Path

All removed methods have WebSocket RPC equivalents or are unused:

| Removed Method | WebSocket RPC Equivalent | Notes |
|---|---|---|
| `getRoot()` | `workspace.get` | Returns `{ ok, root }` |
| `setRoot(newRoot)` | `workspace.open({ root })` | Opens workspace |
| `getSettings()` | `settings.get` | Returns all settings |
| `setSetting(k, v)` | `settings.*` RPCs | Various setting RPCs |
| `bootstrap()` | N/A | Unused |
| `ensureDirectory()` | N/A | Unused |
| `fileExists()` | N/A | Unused |
| `readFile()` | N/A | Unused |
| `writeFile()` | N/A | Unused |
| `listFiles()` | N/A | Unused |
| `notifyRecentFoldersChanged()` | N/A | Main process manages |

---

## Conclusion

The `window.workspace` API is **massively over-exposed**:
- 91% of methods are unused or redundant
- Only `openFolderDialog()` is legitimately needed
- Removing 10 methods improves security and architecture

**Recommendation**: Proceed with removal of 10 unused/redundant methods.

