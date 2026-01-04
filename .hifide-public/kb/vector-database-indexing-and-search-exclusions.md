---
id: e14831f8-0cc2-44b6-a1f7-3b3e5a4f1fbe
title: Vector Database Indexing and Search Exclusions
tags: [architecture, security, indexing, search]
files: [electron/utils/fileDiscovery.ts, electron/services/vector/CodeIndexerService.ts, electron/tools/workspace/searchWorkspace.ts]
createdAt: 2026-01-03T19:33:22.794Z
updatedAt: 2026-01-03T22:52:44.930Z
---

## Directory Exclusions in Indexing and Search

To preserve privacy and prevent self-referential training data leaks, HiFide implements strict directory exclusions for Code Indexing and the `workspaceSearch` tool.

### Excluded Directories
The following directories are excluded by default across all file discovery operations (via `electron/utils/fileDiscovery.ts`):

- `.hifide-public/`: Contains Knowledge Base markdown, activity memories, and kanban tasks.
- `.hifide-private/`: Contains sensitive local configuration, API keys, and environment-specific data.

### Implementation Details

1. **Indexer Isolation**: 
   - The `CodeIndexerService` uses the `discoverWorkspaceFiles` utility which pulls patterns from `DEFAULT_EXCLUDE_PATTERNS`.
   - `respectGitignore` is set to `true` in `CodeIndexerService.ts` to ensure that standard exclusion rules apply consistently.
   
2. **Search Logic**:
   - `workspaceSearch` (via `searchWorkspace.ts`) utilizes the same discovery utility.
   - Semantic fallback results from the Vector DB are pre-filtered to ignore hits originating from the excluded internal directories.

### Verification
When performing a "Code Search" or "Semantic Search" targeting the workspace:
- Matches from `.hifide-public/kb/*.md` must not appear in Code results.
- Sensitive values from `.hifide-private/` must never be indexed or returned in tool results.