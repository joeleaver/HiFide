# Electron/Main Process Cleanup Audit

**Date**: 2025-11-27  
**Status**: Post-Zustand Removal Cleanup

## Executive Summary

After removing Zustand from the main/electron codebase, several cleanup opportunities have been identified:

1. **Dead Store Infrastructure** - Empty slices directory, no-op persistence utilities
2. **Duplicate Security Functions** - `redactOutput` and `isRiskyCommand` duplicated across files
3. **Deprecated Wrapper Functions** - Unnecessary indirection in tools/utils.ts
4. **Outdated Documentation References** - References to deleted Zustand patterns
5. **Hardcoded File Lists** - Maintenance burden in workspace/map.ts
6. **Unused Preload Exposures** - TS refactor APIs that may not be used

---

## 1. Dead Store Infrastructure 🔴 HIGH PRIORITY

### Issue
The `electron/store/` directory contains remnants of the removed Zustand store:
- **Empty directory**: `electron/store/slices/` (0 files)
- **No-op utilities**: `electron/store/utils/persistence.ts` (only contains stub functions)
- **Misleading constants**: `electron/store/utils/constants.ts` references localStorage keys that aren't used
- **Empty utility**: `electron/store/utils/sessions.ts` returns empty arrays

### Files to Remove
```
electron/store/utils/persistence.ts       # No-op stubs, not needed
electron/store/utils/sessions.ts          # Returns empty data, unused
electron/store/utils/constants.ts         # Storage keys for deleted store
electron/store/slices/                    # Empty directory
```

### Files to Keep
```
electron/store/index.ts                   # Type re-exports (used by renderer)
electron/store/types.ts                   # Shared types (heavily used)
electron/store/utils/session-persistence.ts  # Used by SessionService
electron/store/utils/kanban.ts            # Used by KanbanService
electron/store/utils/workspace-helpers.ts # Utility functions (used)
electron/store/utils/knowledgeBase.ts     # Utility functions (used)
electron/store/utils/node-colors.ts       # Re-export from shared
electron/store/utils/connection-colors.ts # Re-export from shared
```

### Action Items
- [ ] Delete `electron/store/utils/persistence.ts`
- [ ] Delete `electron/store/utils/sessions.ts`
- [ ] Delete `electron/store/utils/constants.ts`
- [ ] Remove `electron/store/slices/` directory
- [ ] Update any imports (should be none)

**Estimated Effort**: 15 minutes  
**Risk**: Low (these are already unused)

---

## 2. Duplicate Security Functions 🟡 MEDIUM PRIORITY

### Issue
Security functions are duplicated with fallback logic:

**`electron/utils/security.ts`** (canonical implementation):
- `redactOutput()` - 8 regex patterns for secret detection
- `isRiskyCommand()` - 10 command risk checks

**`electron/tools/utils.ts`** (wrapper with fallback):
- `redactOutput()` - Tries to require security.ts, falls back to 2 patterns
- `isRiskyCommand()` - Tries to require security.ts, falls back to 4 checks

### Problems
1. **Maintenance burden**: Changes must be made in two places
2. **Inconsistent behavior**: Fallback has fewer patterns (less secure)
3. **Unnecessary complexity**: The `require()` + try/catch pattern is fragile
4. **ESM/CJS mixing**: Using `require()` in ESM context

### Solution
Replace wrappers in `electron/tools/utils.ts` with direct imports:

```typescript
// BEFORE (lines 68-83)
export function redactOutput(input: string): { redacted: string; bytesRedacted: number } {
  try {
    const sec = require('../utils/security')
    return sec.redactOutput(input)
  } catch {
    // Fallback with only 2 patterns...
  }
}

// AFTER
import { redactOutput as securityRedactOutput, isRiskyCommand as securityIsRiskyCommand } from '../utils/security.js'

export const redactOutput = securityRedactOutput
export const isRiskyCommand = securityIsRiskyCommand
```

### Action Items
- [ ] Replace `redactOutput` wrapper with direct import
- [ ] Replace `isRiskyCommand` wrapper with direct import
- [ ] Remove fallback implementations
- [ ] Search for any other similar patterns

**Estimated Effort**: 10 minutes  
**Risk**: Low (just removing indirection)

---

## 3. Deprecated Wrapper Functions 🟡 MEDIUM PRIORITY

### Issue
`electron/tools/utils.ts` contains deprecated wrappers:

**Line 15**: `resolveWithinWorkspace()` - Marked as `@deprecated`, just calls the real function
**Lines 112-121**: `applyFileEditsInternal()` and `applyLineRangeEditsInternal()` - Thin wrappers around edits module

### Solution
1. **For `resolveWithinWorkspace`**: Update all callers to import directly from `../utils/workspace`
2. **For edit wrappers**: Either remove or document why they exist (abstraction layer?)

### Action Items
- [ ] Search for all uses of deprecated `resolveWithinWorkspace` from tools/utils
- [ ] Update imports to use `../utils/workspace` directly
- [ ] Remove deprecated function
- [ ] Evaluate if edit wrappers serve a purpose or should be removed

**Estimated Effort**: 20 minutes  
**Risk**: Low (deprecated code)

---

## 4. Outdated Documentation 🟢 LOW PRIORITY

### Issue
Documentation files reference deleted Zustand patterns and outdated architecture:

**`.augment/rules/zustand-zubridge-patterns.md`**:
- Marked as DEPRECATED at top
- Still contains 370+ lines of Zustand/Zubridge patterns
- References `electron/store/slices/` that no longer exist
- References `@zubridge/electron` that was removed

**`docs/remove-zustand-from-electron.md`**:
- Migration tracking document (historical value)
- References files that no longer exist

**`docs/dead-code-cleanup.md`**:
- Tracking document from cleanup process
- May be outdated now

### Solution
1. **zustand-zubridge-patterns.md**: Delete entirely (it's marked DEPRECATED)
2. **remove-zustand-from-electron.md**: Move to `docs/archive/` for historical reference
3. **dead-code-cleanup.md**: Update or archive

### Action Items
- [ ] Delete `.augment/rules/zustand-zubridge-patterns.md`
- [ ] Move migration docs to `docs/archive/`
- [ ] Update or archive cleanup tracking docs

**Estimated Effort**: 10 minutes
**Risk**: None (documentation only)

---

## 5. Hardcoded File Lists 🟡 MEDIUM PRIORITY

### Issue
`electron/tools/workspace/map.ts` (lines 78-83) contains a hardcoded list of "Key Electron files":

```typescript
const electronFiles = uniq([
  'electron/main.ts','electron/core/app.ts','electron/core/window.ts',
  'electron/store/index.ts','electron/tools/index.ts',
  'electron/ipc/registry.ts','electron/ipc/pty.ts',
  'electron/providers-ai-sdk/openai.ts','electron/providers-ai-sdk/anthropic.ts','electron/providers/gemini.ts'
])
```

### Problems
1. **Maintenance burden**: Must be manually updated when files are added/removed/renamed
2. **Outdated reference**: `electron/ipc/pty.ts` doesn't exist (PTY moved to WebSocket)
3. **Inconsistent**: `electron/providers/gemini.ts` should be `electron/providers-ai-sdk/gemini.ts`
4. **Arbitrary selection**: Why these specific files?

### Solution Options
**Option A**: Remove the hardcoded list entirely and use a pattern-based approach
**Option B**: Fix the incorrect paths and document the selection criteria
**Option C**: Generate the list dynamically based on file importance metrics

### Action Items
- [ ] Verify which files in the list actually exist
- [ ] Decide on approach (remove, fix, or make dynamic)
- [ ] Update or remove the hardcoded list
- [ ] Add comments explaining selection criteria if keeping

**Estimated Effort**: 15 minutes
**Risk**: Low (only affects workspace map tool output)

---

## 6. Unused Preload Exposures 🟢 LOW PRIORITY

### Issue
`electron/preload.ts` exposes TypeScript refactoring APIs that may not be used:

**Lines 122-133**: `tsRefactorEx` and `tsExportUtils` expose 4 IPC handlers:
- `tsrefactor:addExportNamed`
- `tsrefactor:moveFile`
- `tsrefactor:ensureDefaultExport`
- `tsrefactor:addExportFrom`

### Questions
1. Are these APIs actually used by the renderer?
2. Are they part of a planned feature or legacy code?
3. Should they be removed or documented?

### Action Items
- [ ] Search renderer code for usage of `window.tsRefactorEx` and `window.tsExportUtils`
- [ ] If unused, remove from preload and IPC handlers
- [ ] If used, add JSDoc comments explaining their purpose

**Estimated Effort**: 20 minutes
**Risk**: Medium (need to verify usage before removing)

---

## 7. Redundant AST-Grep Code 🟡 MEDIUM PRIORITY

### Issue
Multiple tools contain nearly identical AST-grep invocation patterns:

**`electron/tools/code/replaceCall.ts`** (lines 57-69):
```typescript
const res = await astGrepRewrite({
  pattern, rewrite,
  languages: input.languages && input.languages.length ? input.languages : 'auto',
  includeGlobs: input.includeGlobs,
  excludeGlobs: input.excludeGlobs,
  perFileLimit: input.perFileLimit,
  totalLimit: input.totalLimit,
  maxFileBytes: input.maxFileBytes,
  concurrency: input.concurrency,
  dryRun: input.dryRun,
  rangesOnly: input.rangesOnly
})
```

**`electron/tools/code/replaceConsoleLevel.ts`** (lines 47-59): Identical pattern
**`electron/tools/code/applyEditsTargeted.ts`** (lines 194-207): Identical pattern

### Problems
1. **Code duplication**: Same options mapping repeated 3+ times
2. **Maintenance burden**: Changes to defaults must be made in multiple places
3. **Inconsistency risk**: Easy to update one but forget others

### Solution
Create a shared helper function:

```typescript
// electron/tools/code/astGrepHelpers.ts
export function normalizeAstGrepOptions(input: {
  languages?: string[] | 'auto'
  includeGlobs?: string[]
  excludeGlobs?: string[]
  perFileLimit?: number
  totalLimit?: number
  maxFileBytes?: number
  concurrency?: number
  dryRun?: boolean
  rangesOnly?: boolean
}) {
  return {
    languages: input.languages && input.languages.length ? input.languages : 'auto',
    includeGlobs: input.includeGlobs,
    excludeGlobs: input.excludeGlobs,
    perFileLimit: input.perFileLimit,
    totalLimit: input.totalLimit,
    maxFileBytes: input.maxFileBytes,
    concurrency: input.concurrency,
    dryRun: input.dryRun,
    rangesOnly: input.rangesOnly,
  }
}
```

### Action Items
- [ ] Create shared helper for AST-grep options normalization
- [ ] Update all tools to use the helper
- [ ] Verify tests still pass

**Estimated Effort**: 30 minutes
**Risk**: Low (pure refactor, no behavior change)

---

## 8. Duplicate Glob/File Discovery Logic 🟡 MEDIUM PRIORITY

### Issue
Multiple files contain nearly identical file discovery patterns:

**Common pattern** (appears in 5+ files):
```typescript
const include = (opts.includeGlobs && opts.includeGlobs.length ? opts.includeGlobs : ['**/*'])
const exclude = [
  'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.git/**',
  '.hifide-public/**', '.hifide_public/**', '.hifide-private/**', '.hifide_private/**',
  ...(opts.excludeGlobs || [])
]
const files = await fg(include, { cwd, ignore: exclude, absolute: true, onlyFiles: true, dot: false })

// .gitignore filtering
try {
  const gi = await fs.readFile(path.join(cwd, '.gitignore'), 'utf-8').catch(() => '')
  if (gi) {
    const ig = ignore().add(gi)
    const filtered = files.filter(abs => !ig.ignores(path.relative(cwd, abs).replace(/\\/g, '/')))
    files.splice(0, files.length, ...filtered)
  }
} catch {}
```

**Found in**:
- `electron/tools/astGrep.ts` (lines 203-233)
- `electron/tools/text/grep.ts` (lines 274-323)
- `electron/tools/workspace/searchWorkspace.ts` (lines 726-744)
- `electron/tools/code/replaceCall.ts` (lines 76-82, partial)

### Problems
1. **Massive duplication**: 30+ lines repeated across files
2. **Inconsistent exclude lists**: Some have more patterns than others
3. **Maintenance nightmare**: Bug fixes must be applied to all copies

### Solution
Create a shared file discovery utility:

```typescript
// electron/utils/fileDiscovery.ts
export async function discoverWorkspaceFiles(opts: {
  cwd?: string
  includeGlobs?: string[]
  excludeGlobs?: string[]
  respectGitignore?: boolean
}): Promise<string[]>
```

### Action Items
- [ ] Create `electron/utils/fileDiscovery.ts` with shared logic
- [ ] Update all tools to use the shared utility
- [ ] Ensure consistent exclude patterns across all tools
- [ ] Add tests for the shared utility

**Estimated Effort**: 1 hour
**Risk**: Medium (affects multiple critical tools)

---

## 9. Monolithic Files 🔴 HIGH PRIORITY

### Issue
Several files are excessively large and handle multiple responsibilities:

**`electron/tools/astGrep.ts`** - 479 lines
- Language registration (lines 1-100)
- AST-grep search (lines 198-285)
- AST-grep rewrite (lines 330-479)
- Utility functions scattered throughout

**`electron/tools/workspace/searchWorkspace.ts`** - 800+ lines
- Literal search
- Semantic search
- AST-grep integration
- Result merging
- Glob matching utilities
- NL-to-AST pattern conversion

**`electron/store/utils/workspace-helpers.ts`** - 350+ lines
- Path utilities
- Directory operations
- Git operations
- Provider validation
- File listing
- Workspace validation

### Problems
1. **Hard to navigate**: Finding specific functionality is difficult
2. **Testing complexity**: Large files are harder to test thoroughly
3. **Merge conflicts**: More likely with large files
4. **Unclear boundaries**: Multiple responsibilities mixed together

### Solution
Split into focused modules:

**For `astGrep.ts`**:
```
electron/tools/astGrep/
├── index.ts              # Public API
├── languages.ts          # Language registration
├── search.ts             # Search implementation
├── rewrite.ts            # Rewrite implementation
└── utils.ts              # Shared utilities
```

**For `searchWorkspace.ts`**:
```
electron/tools/workspace/search/
├── index.ts              # Main search orchestrator
├── literal.ts            # Literal/ripgrep search
├── semantic.ts           # Semantic/embedding search
├── ast.ts                # AST-grep integration
├── merge.ts              # Result merging logic
└── utils.ts              # Glob matching, etc.
```

**For `workspace-helpers.ts`**:
```
electron/utils/workspace/
├── paths.ts              # Path utilities
├── git.ts                # Git operations
├── files.ts              # File operations
└── validation.ts         # Workspace validation
```

### Action Items
- [ ] Create directory structure for each module
- [ ] Split files into focused modules
- [ ] Update imports across codebase
- [ ] Verify tests still pass
- [ ] Update documentation

**Estimated Effort**: 3-4 hours
**Risk**: High (affects many files, requires careful testing)

---

## Priority Summary

### 🔴 High Priority (Do First)
1. **Dead Store Infrastructure** - Quick wins, removes confusion
2. **Monolithic Files** - Improves maintainability significantly

### 🟡 Medium Priority (Do Soon)
3. **Duplicate Security Functions** - Reduces maintenance burden
4. **Deprecated Wrapper Functions** - Removes technical debt
5. **Hardcoded File Lists** - Prevents future bugs
6. **Redundant AST-Grep Code** - DRY principle
7. **Duplicate Glob/File Discovery** - Major duplication

### 🟢 Low Priority (Nice to Have)
8. **Outdated Documentation** - Cleanup only
9. **Unused Preload Exposures** - Needs investigation first

---

## Estimated Total Effort

- **High Priority**: 4-5 hours
- **Medium Priority**: 3-4 hours
- **Low Priority**: 1 hour

**Total**: 8-10 hours of focused cleanup work

---

## Next Steps

1. Review this audit with the team
2. Prioritize which items to tackle first
3. Create GitHub issues for tracking (optional)
4. Execute cleanup in priority order
5. Update this document as items are completed


