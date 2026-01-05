---
id: cd784144-e772-4a9b-bd1a-8cca377bed43
title: File Watcher and Indexing Exclusions
tags: [watcher, fs, indexing, exclusions, architecture]
files: [electron/utils/fileDiscovery.ts, electron/services/ExplorerService.ts, electron/workers/indexing/v2-watcher-worker.ts]
createdAt: 2026-01-04T05:31:30.118Z
updatedAt: 2026-01-05T00:00:00.000Z
---

# File System Watcher & Indexer Exclusions

## Two Different Use Cases

### 1. Content Discovery (for indexing, search, workspace map)
Uses `electron/utils/fileDiscovery.ts` as single source of truth:
- `discoverWorkspaceFiles()` - respects `.gitignore`, excludes binary files
- `v2-watcher-worker.ts` - mirrors patterns for file change watching
- `workspace/map.ts` - uses `discoverWorkspaceFiles()` directly

### 2. UI File Explorer (ExplorerService)
Minimal ignore list for **performance only** (avoiding file descriptor exhaustion):
- `node_modules` - often 100k+ files
- `.git` - many small objects

The Explorer watcher does NOT filter content - users should see all files in UI.

## Canonical Exclude Patterns

```typescript
// electron/utils/fileDiscovery.ts
export const DEFAULT_EXCLUDE_PATTERNS = [
  // Build outputs
  'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**',
  'build/**', 'out/**', 'coverage/**', 'target/**',

  // Framework-specific
  '.next/**', '.turbo/**', '.cache/**', '.pnpm-store/**', 'vendor/**',

  // Python
  '.venv/**', 'venv/**', '__pycache__/**', '*.pyc',

  // Version control & IDE
  '.git/**', '.idea/**', '.vscode/**',

  // HiFide internal
  '.hifide-public/**', '.hifide-private/**',

  // Binary archives
  '*.zip', '*.tar', '*.tar.gz', etc.
]
```

## Features

- **`.gitignore` Support**: `discoverWorkspaceFiles()` and `v2-watcher-worker` respect `.gitignore`
- **Binary Detection**: `discoverWorkspaceFiles()` filters binary files by content inspection
- **Consistent Indexing**: All LLM-facing tools use same discovery logic