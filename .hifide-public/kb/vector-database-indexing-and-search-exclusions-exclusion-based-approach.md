---
id: e14831f8-0cc2-44b6-a1f7-3b3e5a4f1fbe
title: Vector Database Indexing and Search Exclusions (Exclusion-Based Approach)
tags: [architecture, security, indexing, search, exclusion-based]
files: [electron/utils/fileDiscovery.ts, electron/services/indexing/IndexOrchestrator.ts, electron/services/indexing/WatcherService.ts, electron/tools/workspace/searchWorkspace.ts]
createdAt: 2026-01-03T19:33:22.794Z
updatedAt: 2026-01-04T21:54:08.225Z
---

## Directory Exclusions in Indexing and Search

To preserve privacy and prevent self-referential training data leaks, HiFide implements strict directory exclusions for Code Indexing and the `workspaceSearch` tool.

### Excluded Directories
The following directories are excluded by default across all file discovery operations (via `electron/utils/fileDiscovery.ts`):

- `.hifide-public/`: Contains Knowledge Base markdown, activity memories, and kanban tasks.
- `.hifide-private/`: Contains sensitive local configuration, API keys, and environment-specific data.

### File Discovery Strategy

HiFide uses an **exclusion-based approach** for file discovery rather than file type whitelisting. This ensures all relevant files are indexed while maintaining security:

1. **Include All Files**: By default, `discoverWorkspaceFiles` includes all files (`['**/*']`) in the workspace
2. **Apply Exclusions**: Files are filtered out through:
   - `DEFAULT_EXCLUDE_PATTERNS` (hardcoded patterns like `node_modules`, `.git`, build outputs, etc.)
   - `.gitignore` patterns (workspace-specific exclusions)
   - **Binary file detection** (see [Binary File Detection via Content Inspection](binary-file-detection))
   - User-provided exclusion patterns

### Binary File Detection

To avoid indexing binary files that can't be meaningfully parsed (images, executables, etc.), HiFide uses **content-based binary detection**:

- **Method**: Reads the first 1KB of each file and checks for null bytes and high ratios of non-printable characters
- **Cross-platform**: Works identically on Windows, macOS, and Linux
- **Extension-agnostic**: Detects binary files regardless of file extension
- **Optimization**: Common binary archives (zip, tar, etc.) are excluded by extension to avoid unnecessary file reads

For detailed implementation, see [Binary File Detection via Content Inspection](binary-file-detection).

### Implementation Details

1. **Indexer Isolation**: 
   - The `IndexOrchestrator.discoverWorkspaceFiles()` method uses the `discoverWorkspaceFiles` utility with `respectGitignore: true`
   - No file type whitelist is applied - all files in watched folders are eligible for indexing
   - The file watcher (`WatcherService` / `v2-watcher-worker.ts`) uses the same exclusion logic
   
2. **Search Logic**:
   - `workspaceSearch` (via `searchWorkspace.ts`) utilizes the same discovery utility
   - Semantic fallback results from the Vector DB are pre-filtered to ignore hits originating from the excluded internal directories

### Benefits of Exclusion-Based Approach

- **Future-Proof**: New file types are automatically indexed without code changes
- **Comprehensive**: No risk of missing important configuration, data, or specialized files
- **Maintainable**: Single source of truth for exclusions in `DEFAULT_EXCLUDE_PATTERNS`
- **Privacy-First**: Explicitly excludes sensitive directories rather than trying to guess what to include
- **Binary-Aware**: Automatically excludes binary files without maintaining hardcoded extension lists

### Verification
When performing a "Code Search" or "Semantic Search" targeting the workspace:
- Matches from `.hifide-public/kb/*.md` must not appear in Code results.
- Sensitive values from `.hifide-private/` must never be indexed or returned in tool results.
- All other files (excluding build outputs, dependencies, etc.) are eligible for indexing regardless of extension.
- Binary files (images, executables, etc.) are automatically detected and excluded from indexing.