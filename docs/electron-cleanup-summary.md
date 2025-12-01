# Electron Cleanup - Executive Summary

**Date**: 2025-11-27  
**Audit Document**: [docs/electron-cleanup-audit.md](./electron-cleanup-audit.md)

## Quick Wins (< 1 hour total)

### 1. Delete Dead Store Files (15 min)
```bash
# Remove empty/unused store infrastructure
rm electron/store/utils/persistence.ts
rm electron/store/utils/sessions.ts
rm electron/store/utils/constants.ts
rmdir electron/store/slices
```

**Impact**: Removes confusion, ~150 lines of dead code

### 2. Fix Duplicate Security Functions (10 min)
Replace wrappers in `electron/tools/utils.ts` with direct imports from `electron/utils/security.ts`

**Impact**: Single source of truth, removes fragile require() pattern

### 3. Remove Deprecated Wrapper (10 min)
Remove `resolveWithinWorkspace()` wrapper from `electron/tools/utils.ts` and update callers

**Impact**: Removes technical debt, clearer imports

### 4. Delete Outdated Documentation (10 min)
```bash
# Remove deprecated Zustand documentation
rm .augment/rules/zustand-zubridge-patterns.md

# Archive migration docs
mkdir -p docs/archive
mv docs/remove-zustand-from-electron.md docs/archive/
mv docs/dead-code-cleanup.md docs/archive/
```

**Impact**: Prevents confusion from outdated patterns

---

## Medium Effort (2-3 hours total)

### 5. Fix Hardcoded File List (15 min)
Update `electron/tools/workspace/map.ts` to remove non-existent files:
- `electron/ipc/pty.ts` (doesn't exist)
- Fix `electron/providers/gemini.ts` → `electron/providers-ai-sdk/gemini.ts`

### 6. Consolidate AST-Grep Options (30 min)
Create shared helper in `electron/tools/code/astGrepHelpers.ts` to eliminate duplication across:
- `replaceCall.ts`
- `replaceConsoleLevel.ts`
- `applyEditsTargeted.ts`

**Impact**: DRY principle, easier to maintain defaults

### 7. Consolidate File Discovery (1 hour)
Create `electron/utils/fileDiscovery.ts` with shared logic used by:
- `astGrep.ts`
- `text/grep.ts`
- `workspace/searchWorkspace.ts`
- `code/replaceCall.ts`

**Impact**: Eliminates 30+ lines of duplication per file, consistent behavior

### 8. Investigate Unused Preload APIs (20 min)
Search renderer for usage of:
- `window.tsRefactorEx`
- `window.tsExportUtils`

If unused, remove from preload and IPC handlers.

---

## Large Refactors (3-4 hours each)

### 9. Split Monolithic Files

**Priority 1**: `electron/tools/astGrep.ts` (479 lines)
```
electron/tools/astGrep/
├── index.ts              # Public API
├── languages.ts          # Language registration
├── search.ts             # Search implementation
├── rewrite.ts            # Rewrite implementation
└── utils.ts              # Shared utilities
```

**Priority 2**: `electron/tools/workspace/searchWorkspace.ts` (800+ lines)
```
electron/tools/workspace/search/
├── index.ts              # Main orchestrator
├── literal.ts            # Ripgrep search
├── semantic.ts           # Embedding search
├── ast.ts                # AST-grep integration
├── merge.ts              # Result merging
└── utils.ts              # Glob matching
```

**Priority 3**: `electron/store/utils/workspace-helpers.ts` (350+ lines)
```
electron/utils/workspace/
├── paths.ts              # Path utilities
├── git.ts                # Git operations
├── files.ts              # File operations
└── validation.ts         # Workspace validation
```

**Impact**: Much easier to navigate, test, and maintain

---

## TODO Comments Found

### electron/main.ts (Line 10)
```typescript
// Agent tools registry (TODO: Extract to separate module in future iteration)
```

**Suggestion**: Create `electron/tools/registry.ts` to move agent tools registration out of main.ts

---

## Recommended Execution Order

### Phase 1: Quick Wins (Day 1 - 1 hour)
1. Delete dead store files
2. Fix duplicate security functions
3. Remove deprecated wrapper
4. Delete outdated documentation

**Result**: Immediate cleanup, no risk

### Phase 2: Medium Effort (Day 2 - 3 hours)
5. Fix hardcoded file list
6. Consolidate AST-grep options
7. Consolidate file discovery
8. Investigate unused preload APIs

**Result**: Reduced duplication, easier maintenance

### Phase 3: Large Refactors (Week 2 - as time permits)
9. Split monolithic files (one at a time)
10. Extract agent tools registry from main.ts

**Result**: Better architecture, easier to navigate

---

## Metrics

### Code Reduction
- **Dead code removed**: ~200 lines
- **Duplication eliminated**: ~150 lines (file discovery) + ~50 lines (AST-grep options)
- **Total reduction**: ~400 lines

### Maintainability Improvements
- **Single source of truth**: Security functions, file discovery, AST-grep options
- **Clearer structure**: Monolithic files split into focused modules
- **Less confusion**: Outdated docs removed, deprecated code deleted

### Risk Assessment
- **Quick wins**: ✅ Low risk (already unused/deprecated)
- **Medium effort**: ⚠️ Medium risk (requires testing)
- **Large refactors**: ⚠️ High risk (affects many files, needs careful testing)

---

## Next Steps

1. **Review this summary** with the team
2. **Execute Phase 1** (quick wins) immediately
3. **Schedule Phase 2** for next sprint
4. **Plan Phase 3** as separate tasks with proper testing

See [docs/electron-cleanup-audit.md](./electron-cleanup-audit.md) for detailed analysis of each issue.

