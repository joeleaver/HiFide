# Electron Cleanup Checklist

**Date**: 2025-11-27  
**Status**: Not Started

Use this checklist to track cleanup progress. Check off items as you complete them.

---

## Phase 1: Quick Wins (1 hour total)

### Dead Store Infrastructure (15 min)
- [x] Delete `electron/store/utils/persistence.ts`
- [x] Delete `electron/store/utils/sessions.ts`
- [x] Delete `electron/store/utils/constants.ts`
- [x] Remove `electron/store/slices/` directory
- [x] Verify no imports of deleted files
- [x] Run tests to confirm nothing broke

### Duplicate Security Functions (10 min)
- [x] Update `electron/tools/utils.ts` line 71-83 (redactOutput)
- [x] Update `electron/tools/utils.ts` line 51-66 (isRiskyCommand)
- [x] Replace with direct imports from `electron/utils/security.ts`
- [x] Remove fallback implementations
- [x] Run tests to confirm behavior unchanged

### Deprecated Wrapper (10 min)
- [x] Search for all uses of `resolveWithinWorkspace` from `electron/tools/utils.ts`
- [x] Update imports to use `electron/utils/workspace.ts` directly (using re-export pattern)
- [x] Delete deprecated function from `electron/tools/utils.ts` (line 15-17)
- [x] Run tests to confirm nothing broke

### Outdated Documentation (10 min)
- [x] Delete `.augment/rules/zustand-zubridge-patterns.md`
- [x] Create `docs/archive/` directory
- [x] Move `docs/remove-zustand-from-electron.md` to archive
- [x] Move `docs/dead-code-cleanup.md` to archive
- [x] Update any references to moved docs

**Phase 1 Complete**: [x]

---

## Phase 2: Medium Effort (3 hours total)

### Fix Hardcoded File List (15 min)
- [x] Open `electron/tools/workspace/map.ts`
- [x] Remove `electron/ipc/pty.ts` (doesn't exist)
- [x] Fix `electron/providers/gemini.ts` → `electron/providers-ai-sdk/gemini.ts`
- [x] Add comment explaining selection criteria
- [ ] Consider making list dynamic (optional - deferred)

### Consolidate AST-Grep Options (30 min)
- [x] Create `electron/tools/code/astGrepHelpers.ts`
- [x] Add `normalizeAstGrepOptions()` function
- [x] Update `electron/tools/code/replaceCall.ts` to use helper
- [x] Update `electron/tools/code/replaceConsoleLevel.ts` to use helper
- [x] Update `electron/tools/code/applyEditsTargeted.ts` to use helper
- [x] Run tests to confirm behavior unchanged

### Consolidate File Discovery (1 hour)
- [x] Create `electron/utils/fileDiscovery.ts`
- [x] Implement `discoverWorkspaceFiles()` function
- [x] Define canonical exclude list
- [x] Update `electron/tools/astGrep.ts` to use shared utility (2 locations)
- [x] Update `electron/tools/text/grep.ts` to use shared utility
- [x] Update `electron/tools/workspace/searchWorkspace.ts` to use shared utility
- [x] Update `electron/tools/code/replaceCall.ts` to use shared utility
- [ ] Add tests for file discovery utility (deferred)
- [x] Run all tests to confirm behavior unchanged

### Investigate Unused Preload APIs (20 min)
- [x] Search renderer code for `window.tsRefactorEx`
- [x] Search renderer code for `window.tsExportUtils`
- [x] Confirmed unused in renderer (no references found)
- [x] Added JSDoc comments explaining purpose and noting they're unused but kept for future use
- [x] Decided to keep APIs (not remove) as they're fully implemented and may be used in future
- [x] Run tests to confirm nothing broke

**Phase 2 Complete**: [x]

---

## Phase 3: Large Refactors (3-4 hours each)

### Split astGrep.ts (3 hours)
- [ ] Create `electron/tools/astGrep/` directory
- [ ] Create `index.ts` (public API)
- [ ] Create `languages.ts` (language registration)
- [ ] Create `search.ts` (search implementation)
- [ ] Create `rewrite.ts` (rewrite implementation)
- [ ] Create `utils.ts` (shared utilities)
- [ ] Update all imports across codebase
- [ ] Run tests to confirm behavior unchanged
- [ ] Delete old `electron/tools/astGrep.ts`

### Split searchWorkspace.ts (4 hours)
- [ ] Create `electron/tools/workspace/search/` directory
- [ ] Create `index.ts` (main orchestrator)
- [ ] Create `literal.ts` (ripgrep search)
- [ ] Create `semantic.ts` (embedding search)
- [ ] Create `ast.ts` (AST-grep integration)
- [ ] Create `merge.ts` (result merging)
- [ ] Create `utils.ts` (glob matching)
- [ ] Update all imports across codebase
- [ ] Run tests to confirm behavior unchanged
- [ ] Delete old `electron/tools/workspace/searchWorkspace.ts`

### Split workspace-helpers.ts (3 hours)
- [ ] Create `electron/utils/workspace/` directory
- [ ] Create `paths.ts` (path utilities)
- [ ] Create `git.ts` (git operations)
- [ ] Create `files.ts` (file operations)
- [ ] Create `validation.ts` (workspace validation)
- [ ] Update all imports across codebase
- [ ] Run tests to confirm behavior unchanged
- [ ] Delete old `electron/store/utils/workspace-helpers.ts`

### Extract Agent Tools Registry (1 hour)
- [ ] Create `electron/tools/registry.ts`
- [ ] Move agent tools registration from `electron/main.ts`
- [ ] Export `registerAgentTools()` function
- [ ] Update `electron/main.ts` to import and call registry
- [ ] Remove TODO comment from `electron/main.ts` (line 10)
- [ ] Run tests to confirm behavior unchanged

**Phase 3 Complete**: [ ]

---

## Verification Steps

After each phase:
- [ ] Run `pnpm test` - All tests pass
- [ ] Run `pnpm build` - Build succeeds
- [ ] Run `pnpm dev` - App starts without errors
- [ ] Test basic functionality (create session, run flow, etc.)
- [ ] Check for console errors
- [ ] Commit changes with descriptive message

---

## Metrics Tracking

### Code Reduction
- Lines removed: _____ / ~400 target
- Files deleted: _____ / ~5 target
- Duplication eliminated: _____ / ~200 lines target

### Time Spent
- Phase 1: _____ / 1 hour estimated
- Phase 2: _____ / 3 hours estimated
- Phase 3: _____ / 10-12 hours estimated

---

## Notes

Use this section to track issues, blockers, or decisions made during cleanup:

```
[Date] [Your Name]
- Issue: ...
- Decision: ...
- Reason: ...
```

---

## Completion

- [ ] All phases complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Code review completed
- [ ] Changes merged to main

**Cleanup Complete**: [ ]

