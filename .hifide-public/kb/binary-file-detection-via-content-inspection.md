---
id: f6b54ee3-c2af-47c5-aea3-e426b59a7ee6
title: Binary File Detection via Content Inspection
tags: [file-discovery, binary-files, indexing, exclusion]
files: [electron/utils/fileDiscovery.ts, electron/services/indexing/IndexOrchestrator.ts]
createdAt: 2026-01-04T21:53:29.891Z
updatedAt: 2026-01-04T21:53:29.891Z
---

## Overview

The file discovery system now detects binary files through content inspection rather than hardcoded file extension lists. This provides a more robust and future-proof approach that automatically handles new file types.

## How It Works

The `isBinaryFile()` function checks if a file is binary by:

1. Reading the first 1KB (configurable) of the file
2. Looking for null bytes (`\x00`), which are characteristic of binary files
3. Checking the ratio of non-printable bytes (bytes outside ASCII 9-13 and 32-126)
4. If >30% of bytes are non-printable, the file is considered binary

This approach is:
- **Cross-platform**: Works on Windows, macOS, and Linux
- **File-type agnostic**: Detects binary files regardless of extension
- **Fast**: Only reads the first 1KB of each file
- **Accurate**: Uses heuristics proven by tools like git and grep

## Configuration

The `excludeBinaryFiles` option is enabled by default in `discoverWorkspaceFiles()`:

```typescript
import { discoverWorkspaceFiles } from './utils/fileDiscovery.js'

// Default behavior - excludes binary files
const files = await discoverWorkspaceFiles({
  cwd: '/workspace',
})

// Include binary files if needed
const allFiles = await discoverWorkspaceFiles({
  cwd: '/workspace',
  excludeBinaryFiles: false,
})
```

## Implementation Details

### Location
- `electron/utils/fileDiscovery.ts`

### Key Functions

#### `isBinaryFile(filePath, bufferSize?)`
Async version that returns a Promise<boolean>

#### `isBinaryFileSync(filePath, bufferSize?)`
Synchronous version for use in sync contexts

Both functions:
- Return `true` if the file is binary
- Return `true` if the file cannot be read (conservative approach)
- Default to checking 1024 bytes

### Exclusion Patterns

The `DEFAULT_EXCLUDE_PATTERNS` array now only contains:
- Build output directories (node_modules, dist, etc.)
- Version control (.git)
- IDE directories (.idea, .vscode)
- Known binary archives (zip, tar, etc.) as an optimization

Binary files are detected at runtime, so even unknown file types are properly handled.

## Performance Impact

The content inspection adds minimal overhead:
- Only reads 1KB per file
- Asynchronous for non-blocking operations
- Most common binary archives are still excluded by extension (optimization)

## Testing

Binary detection is tested against:
- Text files: .md, .ts, .js, .json, .yaml, .txt
- Binary files: .png, .jpg, .exe, .dll, .zip, .pdf
- Mixed encodings: UTF-8, UTF-16, ASCII
- Edge cases: Empty files, unreadable files, symbolic links

## See Also
- [File Discovery Utilities](file-discovery)
- [Vector Database Indexing and Search Exclusions](vector-db-indexing)