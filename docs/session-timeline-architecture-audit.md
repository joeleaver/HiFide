# SessionTimelineService Architecture Audit

**Date**: 2025-11-27  
**File**: `electron/services/SessionTimelineService.ts`  
**Current Size**: 1,402 lines  
**Status**: After dead code removal

## Current Architecture

### Public API (3 methods)

1. ✅ **`updateCurrentContext(params)`** - Update session context (provider/model/etc)
   - **Called by**: `scheduler.ts` (line 184), `ProviderService.ts` (lines 135, 168)
   - **Purpose**: Sync context changes to session
   - **Status**: ✅ ACTIVELY USED

2. ✅ **`startNewContext()`** - Clear timeline and reset message history
   - **Called by**: `service-handlers.ts` (line 99)
   - **Purpose**: Reset session when user clicks "New Context"
   - **Status**: ✅ ACTIVELY USED

3. ✅ **`startListeningToFlow(requestId, args)`** - Main event handler
   - **Called by**: `flow-engine/index.ts` (line 36)
   - **Purpose**: Subscribe to flow events and manage timeline
   - **Status**: ✅ ACTIVELY USED - Core of the service

### Public API (2 methods - SUSPECT)

4. ❓ **`stopCurrentRequest()`** - Stop current LLM request
   - **Called by**: NOWHERE! Not found in codebase
   - **Purpose**: Stop flow execution
   - **Status**: ⚠️ DEAD CODE - Never called
   - **Note**: Flow cancellation happens via `FlowService.cancel()` instead

5. ❓ **`ensureLlmIpcSubscription()`** - No-op method
   - **Called by**: NOWHERE! Not found in codebase
   - **Purpose**: Legacy IPC subscription (now no-op)
   - **Status**: ⚠️ DEAD CODE - Just a no-op comment

### Private Helpers (5 methods)

6. ✅ **`getSessionContext()`** - Get session service + current session
   - **Status**: ✅ USED - Helper for public methods

7. ✅ **`getServices()`** - Get services without requiring session
   - **Status**: ✅ USED - Helper for public methods

8. ✅ **`flushNodeExecution(nodeId)`** - Flush buffered content (OLD)
   - **Status**: ⚠️ UNUSED - Replaced by local `flush()` in `startListeningToFlow`
   - **Note**: This is the OLD instance-level method, not used anymore

9. ✅ **`formatToolName(name)`** - Format tool names for display
   - **Status**: ✅ USED - Called in `startListeningToFlow`

10. ✅ **`tryParseHandle(str)`** - Parse file handles from tool output
    - **Status**: ✅ USED - Called in `startListeningToFlow`

11. ✅ **`deriveWorkspaceSearchHeader(args)`** - Generate search headers
    - **Status**: ✅ USED - Called in `startListeningToFlow`

12. ✅ **`deriveFsReadLinesMeta(args)`** - Generate fs.read_lines metadata
    - **Status**: ✅ USED - Called in `startListeningToFlow`

### Instance State

```typescript
interface SessionTimelineState {
  openExecutionBoxes: Record<string, string>  // ⚠️ UNUSED - replaced by local Map in startListeningToFlow
  currentRequestId: string | null             // ⚠️ UNUSED - only set by stopCurrentRequest (dead)
  streamingText: string                       // ⚠️ UNUSED - legacy field
  chunkStats: { count: number; totalChars: number }  // ⚠️ UNUSED - legacy field
  retryCount: number                          // ⚠️ UNUSED - legacy field
  llmIpcSubscribed: boolean                   // ⚠️ UNUSED - legacy IPC field
  doneByRequestId: Record<string, boolean>    // ⚠️ UNUSED - legacy field
}
```

**ALL STATE FIELDS ARE UNUSED!** The service uses local variables in `startListeningToFlow` instead.

### Instance Fields (Buffers)

```typescript
private textBuffers = new Map<string, string>()  // ⚠️ UNUSED - replaced by local Map
private badgeQueues = new Map<string, Array<{ type: 'badge'; badge: Badge }>>()  // ⚠️ UNUSED
private flushTimeouts = new Map<string, NodeJS.Timeout>()  // ⚠️ UNUSED
private nodeMetadata = new Map<...>()  // ⚠️ UNUSED
```

**ALL INSTANCE BUFFERS ARE UNUSED!** The `startListeningToFlow` method creates its own local buffers.

## Architecture Issues

### 1. 🔴 Duplicate Buffer Management

**Problem**: The service has TWO sets of buffers:
- **Instance-level** (lines 35-41): `this.textBuffers`, `this.badgeQueues`, etc - UNUSED
- **Local** (lines 459-463): Created fresh in `startListeningToFlow` - ACTUALLY USED

**Impact**: Confusing code, wasted memory, misleading architecture

### 2. 🔴 Dead State Fields

**Problem**: All 7 state fields are completely unused:
- `openExecutionBoxes` - Replaced by local `openBoxIds` Map
- `currentRequestId` - Only set by dead `stopCurrentRequest()` method
- `streamingText`, `chunkStats`, `retryCount` - Legacy fields from old IPC architecture
- `llmIpcSubscribed`, `doneByRequestId` - Legacy IPC fields

**Impact**: Misleading state interface, wasted memory

### 3. 🔴 Dead Public Methods

**Problem**: 2 public methods are never called:
- `stopCurrentRequest()` - Flow cancellation happens via `FlowService.cancel()` instead
- `ensureLlmIpcSubscription()` - Just a no-op comment

**Impact**: Confusing API surface, misleading documentation

### 4. 🔴 Dead Private Method

**Problem**: `flushNodeExecution(nodeId)` is never called
- Replaced by local `flush()` function in `startListeningToFlow`

**Impact**: Dead code, confusing architecture

## Recommendations

### Phase 1: Remove Dead Code (Immediate)

1. ✅ Delete `stopCurrentRequest()` method (18 lines)
2. ✅ Delete `ensureLlmIpcSubscription()` method (3 lines)
3. ✅ Delete `flushNodeExecution()` method (103 lines)
4. ✅ Delete all instance buffer fields (4 lines)
5. ✅ Delete all state fields (7 fields)

**Total savings**: ~135 lines + clearer architecture

### Phase 2: Simplify Architecture (Optional)

The service is now essentially a **stateless event handler** with only 3 real methods:
- `updateCurrentContext()` - Update session context
- `startNewContext()` - Reset session
- `startListeningToFlow()` - Event-driven timeline management

**Consider**: Rename to `SessionTimelineEventHandler` to reflect true purpose

### Phase 3: Extract Event Handlers (Future)

The `startListeningToFlow` method is 964 lines (69% of file). Consider extracting event handlers:
- `handleChunk()` - Text streaming
- `handleBadge()` - Badge creation/updates
- `handleNodeComplete()` - Node finalization
- `handleUsage()` - Token usage tracking

**Benefit**: Better testability, clearer separation of concerns

## Summary

**Current state**: Service has significant architectural debt from IPC → WebSocket migration
- 2 dead public methods
- 1 dead private method
- 7 unused state fields
- 4 unused instance buffers
- Duplicate buffer management (instance vs local)

**Recommendation**: Clean up dead code immediately (Phase 1), then consider architectural improvements (Phase 2-3)

---

## ✅ PHASE 1 COMPLETE!

**Date**: 2025-11-27
**Status**: ✅ ALL DEAD CODE REMOVED

### Changes Made

1. ✅ Deleted `stopCurrentRequest()` method (18 lines)
2. ✅ Deleted `ensureLlmIpcSubscription()` method (3 lines)
3. ✅ Deleted `flushNodeExecution()` method (110 lines)
4. ✅ Deleted all instance buffer fields (4 lines)
5. ✅ Deleted all state fields (7 fields + interface = 14 lines)
6. ✅ Simplified constructor (5 lines)

**Total removed**: 160 lines

### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total lines** | 1,402 | 1,242 | **-160 lines (-11.4%)** |
| **Public methods** | 5 | 3 | **-2 methods (-40%)** |
| **State fields** | 7 | 0 | **-7 fields (-100%)** |
| **Instance buffers** | 4 | 0 | **-4 buffers (-100%)** |

### Architecture Now

**The service is now a clean, stateless event handler with only 3 methods:**

1. ✅ `updateCurrentContext(params)` - Update session context
2. ✅ `startNewContext()` - Reset session timeline
3. ✅ `startListeningToFlow(requestId, args)` - Event-driven timeline management

**All state is local to `startListeningToFlow`** - no shared instance state!

### Benefits

- ✅ **Clearer architecture** - Stateless service, event-driven design is obvious
- ✅ **No duplicate buffers** - Only local buffers in `startListeningToFlow`
- ✅ **Smaller API surface** - 3 methods instead of 5 (40% reduction)
- ✅ **No dead code** - All methods are actively used
- ✅ **Better testability** - No shared state to manage
- ✅ **Zero compilation errors**
- ✅ **Zero runtime errors**

### Combined Cleanup Results

| Phase | Lines Removed | Description |
|-------|---------------|-------------|
| Boilerplate Elimination | 58 | Helper methods for service retrieval |
| Dead Methods (First Pass) | 248 | Removed 8 unused public methods |
| Dead Code (Architecture) | 160 | Removed state, buffers, dead methods |
| **TOTAL** | **466 lines** | **27.3% reduction** |

**File size**: 1,704 → 1,242 lines (462 lines removed, 27.1% reduction)

