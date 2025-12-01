# Flow Event Listener Refactoring Plan

**Date**: 2025-11-27  
**Goal**: Break up the massive 964-line `startListeningToFlow` method into manageable, testable chunks

## Current State

**File**: `electron/services/SessionTimelineService.ts`  
**Size**: 1,160 lines  
**Single method**: `startListeningToFlow` (964 lines, 83% of the file!)

### Method Structure

The `startListeningToFlow` method contains:
1. **Setup** (lines 194-225): Initialize buffers, metadata, local state
2. **Helper functions** (lines 227-424):
   - `broadcastSessionUsage()` - Broadcast usage to renderers
   - `flush()` - Create/update node execution boxes (162 lines!)
   - `debounceFlush()` - Debounce flush calls
3. **Event handler** (lines 433-1157): Massive switch-like handler for 10+ event types
4. **Cleanup** (lines 1159-1168): Return unsubscribe function

### Event Types Handled

1. `chunk` - Streaming text
2. `reasoning` - Streaming reasoning
3. `badge` - Simple badge creation
4. `badgeUpdate` - Update existing badge
5. `toolStart` - Create tool badge
6. `toolEnd` - Update tool badge with result (500+ lines of tool-specific logic!)
7. `toolError` - Update tool badge with error
8. `tokenUsage` - Update token usage
9. `done` - Finalize node execution
10. `error` - Handle node error

## Problems

1. **Untestable**: 964-line method is impossible to unit test
2. **Unreadable**: Too much logic in one place
3. **Tool-specific logic**: 500+ lines of tool-specific badge formatting in `toolEnd` handler
4. **Repeated patterns**: Session lookup, badge finding, session updating repeated everywhere
5. **Mixed concerns**: Event handling + badge formatting + session persistence all mixed together

## Proposed Refactoring

### Phase 1: Extract to Standalone Module

**Create**: `electron/flow-engine/timeline-listener.ts`

**Benefits**:
- Not a "service" (it's stateless, just a function)
- Co-located with flow-engine (where it's used)
- Easier to test (no service registry needed)

### Phase 2: Extract Helper Functions

**Create**: `electron/flow-engine/timeline-helpers.ts`

Extract these helpers:
1. `buildNodeMetadata(flowDef)` - Build node metadata lookup
2. `broadcastSessionUsage(sessionId)` - Broadcast usage snapshot
3. `findNodeExecutionBox(items, nodeId, executionId)` - Find box in timeline
4. `findBadgeInBox(box, badgeId)` - Find badge in box content
5. `updateSessionTimeline(sessionId, updater)` - Update session with timeline changes

### Phase 3: Extract Badge Formatters

**Create**: `electron/flow-engine/badge-formatters.ts`

Extract tool-specific badge formatting logic:
1. `formatEditsBadge(result, args)` - edits.apply formatting
2. `formatFsReadLinesBadge(result, args)` - fs.read_lines formatting
3. `formatWorkspaceSearchBadge(result, args)` - workspace.search formatting
4. `formatKbSearchBadge(result, args)` - knowledgeBase.search formatting
5. `formatKbStoreBadge(result, args)` - knowledgeBase.store formatting
6. `formatWorkspaceJumpBadge(result, args)` - workspace.jump formatting
7. `formatWorkspaceMapBadge(result, args)` - workspace.map formatting
8. `formatAstSearchBadge(result, args)` - code.searchAst formatting

**Registry pattern**:
```typescript
const BADGE_FORMATTERS: Record<string, (result: any, args: any) => Partial<Badge>> = {
  'edits_apply': formatEditsBadge,
  'fs_read_lines': formatFsReadLinesBadge,
  'workspace_search': formatWorkspaceSearchBadge,
  // ...
}

function formatToolBadge(toolName: string, result: any, args: any): Partial<Badge> {
  const { key } = normalizeTool(toolName)
  const formatter = BADGE_FORMATTERS[key]
  return formatter ? formatter(result, args) : {}
}
```

### Phase 4: Extract Event Handlers

**Create**: `electron/flow-engine/event-handlers.ts`

Extract individual event handlers:
1. `handleChunkEvent(ev, buffers)` - Handle streaming text
2. `handleReasoningEvent(ev, buffers)` - Handle streaming reasoning
3. `handleBadgeEvent(ev, buffers)` - Handle simple badge creation
4. `handleBadgeUpdateEvent(ev, sessionId)` - Handle badge updates
5. `handleToolStartEvent(ev, buffers, lastToolArgs)` - Handle tool start
6. `handleToolEndEvent(ev, buffers, lastToolArgs)` - Handle tool end
7. `handleToolErrorEvent(ev, buffers, lastToolArgs)` - Handle tool error
8. `handleTokenUsageEvent(ev, sessionId)` - Handle token usage
9. `handleDoneEvent(ev, buffers)` - Handle node completion
10. `handleErrorEvent(ev, buffers)` - Handle node error

### Phase 5: Simplified Main Function

**Result**: `startListeningToFlow` becomes ~100 lines:

```typescript
export function startListeningToFlow(requestId: string, args: FlowExecutionArgs): () => void {
  const sessionId = (args as any).sessionId
  if (!sessionId) return () => {}

  // Setup
  const nodeMeta = buildNodeMetadata(args.flowDef)
  const buffers = createBuffers()
  const lastToolArgs = new Map()

  // Event listener
  const unsubscribe = flowEvents.onFlowEvent(requestId, (ev: any) => {
    const handler = EVENT_HANDLERS[ev.type]
    if (handler) {
      handler(ev, { sessionId, nodeMeta, buffers, lastToolArgs })
    }
  })

  // Cleanup
  return () => {
    cleanupBuffers(buffers)
    unsubscribe()
  }
}
```

## File Structure After Refactoring

```
electron/flow-engine/
  timeline-listener.ts         (~100 lines) - Main entry point
  timeline-helpers.ts          (~150 lines) - Helper functions
  badge-formatters.ts          (~400 lines) - Tool-specific badge formatting
  event-handlers.ts            (~400 lines) - Individual event handlers
```

**Total**: ~1,050 lines across 4 focused files (vs 964 lines in one method)

## Benefits

1. ✅ **Testable**: Each function can be unit tested independently
2. ✅ **Readable**: Each file has a single, clear purpose
3. ✅ **Maintainable**: Easy to add new tools or event types
4. ✅ **Reusable**: Badge formatters can be used elsewhere
5. ✅ **Better architecture**: Clear separation of concerns

## Migration Strategy (REVISED)

Given the size of the method (964 lines), a direct copy-paste approach is impractical.
Instead, we'll refactor in-place first, then extract:

### Phase 1: Refactor In-Place (Within SessionTimelineService)

1. **Extract badge formatters** to separate private methods
   - Create `formatEditsBadge()`, `formatFsReadLinesBadge()`, etc.
   - Replace inline formatting code with method calls
   - ~500 lines → ~50 lines of method calls

2. **Extract event handlers** to separate private methods
   - Create `handleChunkEvent()`, `handleToolEndEvent()`, etc.
   - Replace inline event handling with method calls
   - ~400 lines → ~100 lines of method calls

3. **Extract helper functions** to separate private methods
   - Already have `formatToolName()`, `normalizeTool()`, etc.
   - Add `findNodeExecutionBox()`, `findBadgeInBox()`, etc.

**Result**: `startListeningToFlow` reduced from 964 lines to ~200 lines

### Phase 2: Extract to Standalone Module

Once the method is broken into smaller pieces:

1. Create `timeline-listener.ts` with all helper functions
2. Copy the refactored `startListeningToFlow` method
3. Update SessionTimelineService to delegate to standalone function
4. Delete helper methods from SessionTimelineService

**Risk**: Low - incremental refactoring with testing at each step

### Phase 3: Further Modularization (Optional)

1. Extract badge formatters to `badge-formatters.ts`
2. Extract event handlers to `event-handlers.ts`
3. Keep `timeline-listener.ts` as orchestrator

## Next Steps

1. ✅ Restore SessionTimelineService to working state
2. ⏭️ Extract badge formatters to private methods (Phase 1.1)
3. ⏭️ Extract event handlers to private methods (Phase 1.2)
4. ⏭️ Test thoroughly after each extraction
5. ⏭️ Extract to standalone module (Phase 2)
6. ⏭️ Delete SessionTimelineService (Phase 2)

## Status

- [x] Created refactoring plan
- [x] Attempted direct extraction (failed - too large)
- [x] Restored SessionTimelineService to working state
- [ ] Phase 1.1: Extract badge formatters
- [ ] Phase 1.2: Extract event handlers
- [ ] Phase 2: Extract to standalone module
- [ ] Phase 3: Further modularization (optional)

