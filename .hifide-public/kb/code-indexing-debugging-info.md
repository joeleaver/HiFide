---
id: 4ccfe4df-f28e-42b8-a8c9-40335f690a60
title: Code Indexing Debugging Info
tags: [indexing, bug, workers]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/discovery-worker.js]
createdAt: 2026-01-04T02:07:30.730Z
updatedAt: 2026-01-04T02:08:43.299Z
---

# Code Indexing Debugging Info

## Issue: File Discovery Hanging
The `CodeIndexerService` was silent after "Starting offloaded discovery".

### Root Cause Found (2025-01-20)
The ESM `discovery-worker` was attempting to use a named export `import { globby } from 'globby'`, but the installed version of `globby` (likely v11+ in a CommonJS-heavy environment or specific Node configuration) was being treated as a CommonJS module by the loader, which does not support named exports for its primary function.

This caused a `SyntaxError: Named export 'globby' not found`, which was previously silent until improved logging was added.

### Solution
Switch to default import for `globby`:
```javascript
import pkg from 'globby';
const { globby } = pkg;
```

### Current Status
- [x] Identify SyntaxError in worker thread.
- [x] Fix `globby` import in `discovery-worker.js`.
- [ ] Verify discovery completes and passes file list back to `CodeIndexerService`.

## Related Files
- `electron/services/vector/CodeIndexerService.ts`
- `electron/workers/indexing/discovery-worker.js`