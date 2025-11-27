# Flow Engine Refactor Plan

## Goals

1. **Consolidate badge logic** - Move ALL badge creation to SessionTimelineService
2. **Rename flows-v2** - Rename to `flow-engine` (clearer name)
3. **Simplify flow-engine/index.ts** - Remove persistence logic (676 lines → ~200 lines)
4. **Remove Zustand dependencies** - Use services instead

---

## Current State (SCARY!)

### Badge Logic in 3 Places 🚨

1. **flows-v2/index.ts** (Main Process)
   - Lines 75-600+: ~500 lines of badge creation
   - `formatToolName()`, metadata derivation, badge construction
   - Listens to flow events and creates badges

2. **flowEditor.slice.ts** (Old Zustand - Being Removed)
   - Lines 1766-2800: ~1000 lines of badge logic
   - Duplicate `formatToolName()`, metadata extraction
   - Will be deleted anyway

3. **Renderer (src/components/)** (UI Rendering)
   - ToolBadgeContainer.tsx, BadgeDiffContent.tsx, etc.
   - **This is correct** - UI rendering belongs here

### flows-v2/index.ts Breakdown (875 lines)

| Lines | What | Should Be |
|-------|------|-----------|
| 1-26 | Imports, registry | ✅ Keep |
| 27-703 | `setupPersistenceForFlow()` | ❌ Move to SessionTimelineService |
| 704-875 | Public API functions | ✅ Keep |

**Problem**: 77% of the file (676/875 lines) doesn't belong there!

---

## Target Architecture

### SessionTimelineService Responsibilities

1. Listen to flow execution events
2. Create node execution boxes
3. Create badges from tool events
4. Buffer text chunks (debounced)
5. Queue badges (immediate flush)
6. Persist to session
7. Broadcast to renderer

### flow-engine/index.ts Responsibilities

1. Manage scheduler registry (`activeFlows` Map)
2. Provide public API (`executeFlow`, `cancelFlow`, `resumeFlow`)
3. Create/destroy scheduler instances
4. **That's it!**

---

## Migration Steps

### Phase 1: Rename flows-v2 → flow-engine

1. Rename directory: `electron/flow-engine/` → `electron/flow-engine/`
2. Update all imports across codebase
3. Update documentation

### Phase 2: Move Badge Logic to SessionTimelineService

1. Add event listener to SessionTimelineService
2. Move `formatToolName()` and metadata helpers
3. Move badge creation logic for all tool types
4. Move text buffering and badge queuing
5. Move flush logic

### Phase 3: Simplify flow-engine/index.ts

1. Remove `setupPersistenceForFlow()` function (676 lines)
2. Call SessionTimelineService.startListening(requestId) instead
3. Target: ~200 lines total

### Phase 4: Clean Up

1. Remove badge logic from flowEditor.slice.ts (being deleted anyway)
2. Verify no duplicate code remains
3. Test end-to-end

---

## File Changes

### New/Modified Files

- `electron/services/SessionTimelineService.ts` - Add event listener and badge logic
- `electron/flow-engine/index.ts` - Simplified (875 → ~200 lines)
- All files importing from `flows-v2/` - Update imports

### Deleted Code

- `setupPersistenceForFlow()` from flow-engine/index.ts (676 lines)
- Badge logic from flowEditor.slice.ts (will be deleted with Zustand removal)

---

## Benefits

1. ✅ **Single source of truth** for badge creation
2. ✅ **Clearer architecture** - flow-engine manages schedulers, SessionTimelineService manages timeline
3. ✅ **77% reduction** in flow-engine/index.ts (875 → ~200 lines)
4. ✅ **No Zustand dependencies** in flow-engine
5. ✅ **Easier to maintain** - badge logic in one place
6. ✅ **Better name** - "flow-engine" is clearer than "flows-v2"

---

## Risks

1. **Breaking changes** - All imports need updating
2. **Event timing** - Need to ensure SessionTimelineService receives events
3. **Testing** - Need to verify badges still work correctly

---

## Next Steps

1. Start with Phase 1 (rename)
2. Then Phase 2 (move badge logic)
3. Then Phase 3 (simplify)
4. Test thoroughly

