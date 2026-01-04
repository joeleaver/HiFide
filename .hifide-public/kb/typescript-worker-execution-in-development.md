---
id: ca4c1530-8155-433a-8bc1-73f3f417154e
title: TypeScript Worker Execution in Development
tags: [typescript, worker-threads, electron, development, ts-node]
files: [electron/services/indexing/WatcherService.ts, electron/services/indexing/IndexOrchestrator.ts]
createdAt: 2026-01-04T17:45:15.791Z
updatedAt: 2026-01-04T17:48:05.622Z
---

# TypeScript Worker Execution in Development

## Problem
In an Electron/Vite environment, executing TypeScript files directly in `worker_threads` (e.g., `new Worker('./worker.ts')`) fails because the worker process does not natively understand TypeScript. It typically throws `ERR_UNKNOWN_FILE_EXTENSION`.

## Solution: `ts-node/register`

To enable TypeScript execution in workers during development, you must register `ts-node` in the worker process.

### Implementation

1.  **Identify Development Environment:** Check if the worker path ends with `.ts`.
2.  **Pass `execArgv`:** Use the `execArgv` option in the `Worker` constructor to pre-load `ts-node/register`.
3.  **Resolve Path Absolutely:** 
    *   **Do NOT** use `require.resolve('ts-node/register')` as it can fail in certain Electron contexts (throwing `MODULE_NOT_FOUND` or failing silently if the context is `import.meta.url`).
    *   **DO** construct the absolute path using `process.cwd()`.

### Code Example

```typescript
import path from 'node:path';
import { Worker } from 'node:worker_threads';

// ... inside your service ...

const workerPath = this.getWorkerPath(); // e.g., .../worker.ts
let execArgv: string[] | undefined = undefined;

if (workerPath.endsWith('.ts')) {
    // Construct absolute path to ts-node/register
    // Assumes node_modules is at the project root (process.cwd())
    const tsNodePath = path.join(process.cwd(), 'node_modules', 'ts-node', 'register');
    execArgv = ['-r', tsNodePath];
}

this.worker = new Worker(workerPath, {
    workerData: { ... },
    execArgv // <--- Important: passes the registration to the worker
});
```

## Why Absolute Path?
Using `process.cwd()` is more reliable in the Electron main process during development because:
1.  `require.resolve` behavior can vary depending on the bundler (Vite/Esbuild) and the file's format (ESM vs CJS).
2.  `import.meta.url` might point to a location where resolution logic behaves differently than expected.
3.  The project root is consistent in the development runner.