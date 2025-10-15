# Flow Cache Removal

## Summary

Removed the unused `flowCache` module that was causing IPC handler errors. This was dead code that was never actually used for caching.

## What Was Removed

### Files Deleted
1. **`electron/app/cache/flowCache.ts`** - Persistent cache implementation
2. **`electron/ipc/flowCache.ts`** - IPC handlers for cache stats/clear

### Code Removed

#### `electron/preload.ts`
- Removed `flowCache` API exposure (lines 264-268)
```typescript
// REMOVED:
contextBridge.exposeInMainWorld('flowCache', {
  stats: () => ipcRenderer.invoke('flowCache:stats'),
  clear: () => ipcRenderer.invoke('flowCache:clear'),
})
```

#### `src/store/slices/flowEditor.slice.ts`
- Removed `CacheStats` type definition
- Removed `feCacheStats` state property
- Removed `feRefreshCacheStats` action
- Removed initial cache stats call in `initFlowEditor`

## Why It Was Removed

### The Problem
The `flowCache` module was causing this error:
```
Error occurred in handler for 'flowCache:stats': Error: No handler registered for 'flowCache:stats'
```

### Root Cause Analysis
1. **Frontend was calling it**: `window.flowCache.stats()` in flowEditor slice
2. **Backend existed**: Implementation in `electron/app/cache/flowCache.ts`
3. **IPC handlers were missing**: Never registered in the main process
4. **But it was NEVER USED**: Only `stats()` and `clear()` were called, never `get()` or `set()`

### What It Was Supposed To Do
The `flowCache` was intended to be a **persistent cache** for LLM responses across flow executions:
- Store responses in `.hifide-private/flow-cache.json`
- TTL-based expiration
- Save API costs by reusing responses

### Why It Was Dead Code
- **Never implemented**: No node actually used `flowCache.get()` or `flowCache.set()`
- **Only stats shown**: UI only displayed "0 entries, 0 bytes" forever
- **Confusing**: Mixed up with two other "caches":
  1. **Scheduler's pullCache** - In-memory cache for flow execution (KEPT)
  2. **Gemini context caching** - Provider-level caching (KEPT)

## What Remains (The Good Caches)

### 1. Scheduler Pull Cache (In-Memory)
**Location**: `electron/ipc/flows-v2/scheduler.ts`
**Purpose**: Prevents re-execution of nodes during a single flow run
**Scope**: Per-execution (temporary)
**Status**: ✅ Active and working

### 2. Gemini Context Caching
**Location**: `electron/providers/gemini.ts`
**Purpose**: Provider-level caching of conversation context
**Scope**: Managed by Google's API
**Status**: ✅ Active and working
**UI**: Shows `💾 X cached` badges in chat

## Migration Notes

### For Developers
- No action needed - this was unused code
- If you see references to "cache" in the UI, they refer to:
  - Gemini context caching (the `💾` badges)
  - Scheduler pull cache (internal execution optimization)

### For Future Implementation
If you want to implement persistent LLM response caching:
1. Create a new `cache` node type
2. Implement `flowCache.get()` and `flowCache.set()` calls in the node
3. Register IPC handlers in `electron/ipc/registry.ts`
4. Add cache key generation (hash of provider + model + input)
5. Add UI controls for cache management

## Files Modified

1. ✅ `electron/app/cache/flowCache.ts` - DELETED
2. ✅ `electron/ipc/flowCache.ts` - DELETED
3. ✅ `electron/preload.ts` - Removed flowCache API
4. ✅ `src/store/slices/flowEditor.slice.ts` - Removed cache stats state/actions
5. ✅ `src/components/FlowNode/NodeConfig.tsx` - Removed "Cache Enabled" checkbox from chat node config
6. ✅ `docs/configuring-nodes.md` - Removed cache settings from documentation

## Testing

- ✅ No TypeScript errors
- ✅ No runtime errors
- ✅ UI still shows Gemini cache badges correctly
- ✅ Flow execution still works with scheduler pull cache

## Related Issues

This fixes the error:
```
Error occurred in handler for 'flowCache:stats': Error: No handler registered for 'flowCache:stats'
```

The error occurred because:
1. Frontend called `window.flowCache.stats()`
2. Preload exposed the IPC call
3. But no handler was registered in the main process
4. And the cache was never actually used anyway

Now the error is gone and the dead code is removed! 🎉

