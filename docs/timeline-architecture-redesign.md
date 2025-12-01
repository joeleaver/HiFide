# Timeline Architecture Redesign

**Date**: 2025-11-27  
**Status**: Phase 1 Complete - Main process refactored  
**Next**: Phase 2 - Renderer badge formatting

## Problem

The original `SessionTimelineService.startListeningToFlow` method (964 lines!) had severe architectural issues:

1. **Badge formatting in main process** - UI presentation logic doesn't belong in main
2. **Tool-specific formatting** - 500+ lines of tool-specific badge formatting (diffs, file paths, etc.)
3. **Mixed concerns** - Event handling + data persistence + UI formatting all in one place
4. **Untestable** - Too large and complex to unit test
5. **Wrong separation** - Main process doing renderer's job

## Solution

### Phase 1: Clean Main Process (✅ COMPLETE)

Created `electron/flow-engine/timeline-event-handler.ts` (385 lines) with proper separation:

**Main process is ONLY responsible for:**
- Buffering streaming text/reasoning (debounced)
- Creating node execution boxes in session timeline
- Storing **raw** tool call data (args, results, errors)
- Tracking token usage
- Broadcasting changes to renderers

**Main process is NOT responsible for:**
- Badge formatting (renderer's job)
- UI presentation logic (renderer's job)
- Diff computation (renderer's job)
- File path extraction (renderer's job)
- Tool-specific display logic (renderer's job)

**Key changes:**
```typescript
// OLD: Main process formats badges with tool-specific logic
if (toolName === 'edits.apply') {
  const files = result.files || []
  const diffs = files.map(f => computeLineDiff(f.before, f.after))
  badge.metadata = { files, diffs, ... }
}

// NEW: Main process stores raw data
toolCalls.push({
  id: `tool-${Date.now()}`,
  toolName: ev.toolName,
  args: ev.toolArgs,      // Raw args
  result: ev.result,      // Raw result
  status: 'success',
})
```

**Data flow:**
```
Flow Events → Timeline Handler → Session Storage → Renderer
                                                      ↓
                                              Badge Formatter
                                                      ↓
                                                  UI Display
```

### Phase 2: Renderer Badge Formatting (⏭️ TODO)

Move all badge formatting logic to renderer:

**Create**: `src/components/session/badge-formatters/`
```
badge-formatters/
  index.ts              - Registry and dispatcher
  edits-apply.tsx       - Format edits.apply badges
  fs-read-lines.tsx     - Format fs.read_lines badges
  workspace-search.tsx  - Format workspace.search badges
  kb-search.tsx         - Format knowledgeBase.search badges
  default.tsx           - Default formatter for unknown tools
```

**Pattern**:
```typescript
// src/components/session/badge-formatters/index.ts
export function formatBadge(badge: Badge): React.ReactNode {
  const formatter = FORMATTERS[badge.toolName] || defaultFormatter
  return formatter(badge)
}

// src/components/session/badge-formatters/edits-apply.tsx
export function formatEditsApplyBadge(badge: Badge) {
  const files = badge.result?.files || []
  
  return (
    <BadgeContainer>
      <BadgeHeader>
        {files.length} file{files.length !== 1 ? 's' : ''} edited
      </BadgeHeader>
      <BadgeContent>
        {files.map(f => (
          <FileDiff
            key={f.path}
            path={f.path}
            before={f.before}
            after={f.after}
          />
        ))}
      </BadgeContent>
    </BadgeContainer>
  )
}
```

**Benefits**:
- Badge formatting happens where it belongs (renderer)
- Can use React components, hooks, context
- Easy to add new tool formatters
- Main process stays clean and simple
- Testable in isolation

### Phase 3: Delete SessionTimelineService (⏭️ TODO)

Once renderer handles formatting:
1. Delete `electron/services/SessionTimelineService.ts` (1,671 lines!)
2. Remove from service registry
3. Update any remaining references

## Architecture Comparison

### Before
```
Main Process (SessionTimelineService):
- Listen to flow events ✓
- Buffer streaming text ✓
- Create timeline boxes ✓
- Format badges for edits.apply ✗
- Format badges for fs.read_lines ✗
- Format badges for workspace.search ✗
- Compute diffs ✗
- Extract file paths ✗
- ... 500+ lines of tool-specific logic ✗

Renderer:
- Display pre-formatted badges
```

### After
```
Main Process (timeline-event-handler.ts):
- Listen to flow events ✓
- Buffer streaming text ✓
- Create timeline boxes ✓
- Store raw tool data ✓

Renderer (badge-formatters/):
- Format badges for edits.apply ✓
- Format badges for fs.read_lines ✓
- Format badges for workspace.search ✓
- Compute diffs ✓
- Extract file paths ✓
- All tool-specific display logic ✓
```

## Files Changed

### Created
- `electron/flow-engine/timeline-event-handler.ts` (385 lines)

### Modified
- `electron/flow-engine/index.ts`
  - Import `startTimelineListener` instead of `SessionTimelineService`
  - Replace `persistSubs` with `timelineListeners`
  - Clean separation of concerns

### To Delete (Phase 3)
- `electron/services/SessionTimelineService.ts` (1,671 lines)

## Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Main process lines | 1,671 | 385 | -77% |
| Badge formatting in main | 500+ lines | 0 lines | -100% |
| Tool-specific logic in main | Yes | No | ✓ |
| Separation of concerns | Poor | Excellent | ✓ |
| Testability | Impossible | Easy | ✓ |

## Next Steps

1. ✅ Create timeline-event-handler.ts
2. ✅ Update flow-engine/index.ts
3. ⏭️ Create renderer badge formatters
4. ⏭️ Update SessionTimeline component to use formatters
5. ⏭️ Delete SessionTimelineService
6. ⏭️ Test thoroughly

## Key Insights

1. **Main process should store data, not format it** - Presentation logic belongs in renderer
2. **Raw data is better than formatted data** - Renderer can format however it wants
3. **Separation of concerns is critical** - 964-line methods are a code smell
4. **Badge formatting is UI logic** - Should use React components, not string manipulation
5. **Simpler main process = more reliable** - Less code = fewer bugs

