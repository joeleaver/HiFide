# Bad Patterns Found in Electron Codebase

**Date**: 2025-11-27  
**Purpose**: Document anti-patterns and code smells for future reference

---

## 1. 🔴 Fallback Pattern with require() in ESM

### Location
`electron/tools/utils.ts` (lines 51-83)

### Pattern
```typescript
export function redactOutput(input: string): { redacted: string; bytesRedacted: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sec = require('../utils/security')
    return sec.redactOutput(input)
  } catch {
    // Fallback implementation with fewer patterns
    let redacted = input || ''
    const patterns: RegExp[] = [/(?:sk|rk|pk|ak)-[A-Za-z0-9]{16,}/g, /Bearer\s+[A-Za-z0-9\-_.=]+/gi]
    const beforeLen = redacted.length
    for (const re of patterns) redacted = redacted.replace(re, '[REDACTED]')
    return { redacted, bytesRedacted: Math.max(0, beforeLen - redacted.length) }
  }
}
```

### Why It's Bad
1. **Mixing CJS and ESM**: Using `require()` in an ESM module
2. **Fragile**: If import fails, silently uses weaker fallback
3. **Inconsistent behavior**: Fallback has only 2 patterns vs 8 in canonical version
4. **Security risk**: Fallback is less secure but fails silently
5. **Maintenance burden**: Two implementations to maintain

### Fix
```typescript
import { redactOutput as securityRedactOutput } from '../utils/security.js'
export const redactOutput = securityRedactOutput
```

---

## 2. 🟡 Hardcoded File Lists

### Location
`electron/tools/workspace/map.ts` (lines 78-83)

### Pattern
```typescript
const electronFiles = uniq([
  'electron/main.ts','electron/core/app.ts','electron/core/window.ts',
  'electron/store/index.ts','electron/tools/index.ts',
  'electron/ipc/registry.ts','electron/ipc/pty.ts',  // ← This file doesn't exist!
  'electron/providers-ai-sdk/openai.ts','electron/providers-ai-sdk/anthropic.ts','electron/providers/gemini.ts'  // ← Wrong path!
])
```

### Why It's Bad
1. **Stale references**: Contains paths to files that don't exist
2. **Manual maintenance**: Must be updated when files are renamed/moved
3. **No validation**: No check that files actually exist
4. **Arbitrary selection**: No clear criteria for what's "key"

### Fix Options
**Option A**: Remove entirely and use pattern-based discovery
**Option B**: Generate dynamically based on metrics (imports, LOC, etc.)
**Option C**: At minimum, validate paths exist and add comments explaining selection

---

## 3. 🔴 Massive Code Duplication (File Discovery)

### Locations
- `electron/tools/astGrep.ts` (lines 203-233)
- `electron/tools/text/grep.ts` (lines 274-323)
- `electron/tools/workspace/searchWorkspace.ts` (lines 726-744)
- `electron/tools/code/replaceCall.ts` (lines 76-82)

### Pattern
```typescript
// This exact pattern appears in 4+ files:
const include = (opts.includeGlobs && opts.includeGlobs.length ? opts.includeGlobs : ['**/*'])
const exclude = [
  'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.git/**',
  '.hifide-public/**', '.hifide_public/**', '.hifide-private/**', '.hifide_private/**',
  ...(opts.excludeGlobs || [])
]
const files = await fg(include, { cwd, ignore: exclude, absolute: true, onlyFiles: true, dot: false })

// .gitignore filtering (best-effort)
try {
  const gi = await fs.readFile(path.join(cwd, '.gitignore'), 'utf-8').catch(() => '')
  if (gi) {
    const ig = ignore().add(gi)
    const filtered = files.filter(abs => !ig.ignores(path.relative(cwd, abs).replace(/\\/g, '/')))
    files.splice(0, files.length, ...filtered)
  }
} catch {}
```

### Why It's Bad
1. **30+ lines duplicated** across multiple files
2. **Inconsistent exclude lists**: Some files have more patterns than others
3. **Bug multiplication**: A bug fix must be applied to all copies
4. **Maintenance nightmare**: Easy to update one and forget others

### Fix
Create `electron/utils/fileDiscovery.ts`:
```typescript
export async function discoverWorkspaceFiles(opts: {
  cwd?: string
  includeGlobs?: string[]
  excludeGlobs?: string[]
  respectGitignore?: boolean
}): Promise<string[]>
```

---

## 4. 🟡 No-Op Functions That Pretend to Work

### Location
`electron/store/utils/persistence.ts`

### Pattern
```typescript
/**
 * No-op in main process - persist middleware handles this
 */
export function getFromLocalStorage<T>(_key: string, defaultValue: T): T {
  return defaultValue
}

/**
 * No-op in main process - persist middleware handles this
 */
export function setInLocalStorage<T>(_key: string, _value: T): void {
  // No-op - persist middleware handles all persistence
}
```

### Why It's Bad
1. **Misleading API**: Functions that look like they do something but don't
2. **Dead code**: These are never called (Zustand was removed)
3. **Confusing**: New developers might think these are needed
4. **Maintenance burden**: Code that serves no purpose

### Fix
Delete the entire file. If any code still imports these, update to use the actual persistence mechanism.

---

## 5. 🟡 Deprecated Functions Still in Use

### Location
`electron/tools/utils.ts` (line 15)

### Pattern
```typescript
/**
 * Resolve a path within the workspace, preventing directory traversal
 * @deprecated Use resolveWithinWorkspace from '../utils/workspace' directly
 */
export function resolveWithinWorkspace(p: string): string {
  return resolveWithinWorkspaceUtil(p)
}
```

### Why It's Bad
1. **Unnecessary indirection**: Just wraps another function
2. **Marked deprecated** but still exported and used
3. **Confusing imports**: Two ways to import the same function
4. **Technical debt**: Should have been removed when deprecated

### Fix
1. Search for all uses of the deprecated function
2. Update imports to use `../utils/workspace` directly
3. Delete the deprecated wrapper

---

## 6. 🔴 Monolithic Files (Multiple Responsibilities)

### Examples

**`electron/tools/astGrep.ts`** (479 lines):
- Language registration
- AST-grep search
- AST-grep rewrite
- Utility functions

**`electron/tools/workspace/searchWorkspace.ts`** (800+ lines):
- Literal search
- Semantic search
- AST-grep integration
- Result merging
- Glob matching
- NL-to-AST conversion

**`electron/store/utils/workspace-helpers.ts`** (350+ lines):
- Path utilities
- Directory operations
- Git operations
- Provider validation
- File listing

### Why It's Bad
1. **Hard to navigate**: Finding specific code is difficult
2. **Testing complexity**: Large files are harder to test
3. **Merge conflicts**: More likely with large files
4. **Unclear boundaries**: Multiple responsibilities mixed
5. **Cognitive load**: Too much to understand at once

### Fix
Split into focused modules with single responsibilities (see audit doc for detailed structure)

---

## 7. 🟡 Inconsistent Exclude Patterns

### Problem
Different tools use different exclude patterns:

**astGrep.ts**:
```typescript
const exclude = [
  'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.git/**',
  '.hifide-public/**', '.hifide_public/**', '.hifide-private/**', '.hifide_private/**',
  ...(opts.excludeGlobs || [])
]
```

**grep.ts**:
```typescript
let excludeGlobs = [
  'node_modules/**','dist/**','dist-electron/**','release/**','.git/**',
  'coverage/**','.next/**','out/**','build/**','.turbo/**','.cache/**','target/**','vendor/**','.pnpm-store/**',
  '.venv/**','venv/**','.idea/**',
  '.hifide-public/**','.hifide_public/**','.hifide-private/**','.hifide_private/**'
].concat(options.exclude || [])
```

### Why It's Bad
1. **Inconsistent behavior**: Same operation excludes different files depending on which tool you use
2. **Maintenance burden**: Must update multiple lists
3. **Easy to miss**: Adding a new pattern requires updating all lists

### Fix
Define a canonical exclude list in one place and import it everywhere.

---

## Summary of Anti-Patterns

| Pattern | Severity | Occurrences | Fix Effort |
|---------|----------|-------------|------------|
| require() fallback in ESM | 🔴 High | 2 | 10 min |
| Hardcoded file lists | 🟡 Medium | 1 | 15 min |
| Massive code duplication | 🔴 High | 4+ | 1 hour |
| No-op functions | 🟡 Medium | 1 file | 5 min |
| Deprecated wrappers | 🟡 Medium | 1+ | 20 min |
| Monolithic files | 🔴 High | 3+ | 3-4 hours each |
| Inconsistent patterns | 🟡 Medium | 4+ | 30 min |

---

## Lessons Learned

1. **Avoid fallback patterns**: If an import fails, fail loudly
2. **DRY principle**: Extract common patterns immediately
3. **Delete deprecated code**: Don't just mark it deprecated
4. **Single responsibility**: Keep files focused
5. **Consistent patterns**: Use shared utilities for common operations
6. **Validate assumptions**: Check that hardcoded paths exist
7. **ESM only**: Don't mix require() and import

---

## Prevention Strategies

1. **Code review checklist**: Check for these patterns in PRs
2. **Linting rules**: Add ESLint rules to catch some patterns
3. **Shared utilities**: Create utilities for common operations
4. **Regular audits**: Review codebase quarterly for duplication
5. **Delete aggressively**: Remove code as soon as it's unused

