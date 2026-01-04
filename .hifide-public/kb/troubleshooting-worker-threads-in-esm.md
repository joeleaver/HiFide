---
id: ef4f9765-5a6e-434c-b030-3bebd024c414
title: Troubleshooting Worker Threads in ESM
tags: [troubleshooting, esm, worker-threads, electron]
files: []
createdAt: 2026-01-04T03:07:25.982Z
updatedAt: 2026-01-04T03:07:25.982Z
---

## Troubleshooting Worker Threads in ESM

### Error: `ReferenceError: require is not defined in ES module scope`

This error occurs when a Node.js worker thread is loaded as an ECMAScript Module (ESM) but contains CommonJS style `require()` calls.

#### Root Causes:
1.  **File Extension:** The worker file has an `.mjs` extension or the project is configured as `"type": "module"`.
2.  **Usage of `require`:** The worker logic uses `const ... = require(...)`.

#### Solution:
1.  **Convert to ESM Imports:** Replace `const { ... } = require(...)` with `import { ... } from '...'`.
2.  **Explicit Protocol:** Use `node:` protocol for built-in modules (e.g., `import { Worker } from 'node:worker_threads'`).
3.  **createRequire (Fallback):** If you absolutely must use CJS dependencies in ESM, use the `module` shim:
    ```javascript
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    ```

### Error: `Assertion failed: !flush_tasks_` (Native Crash)

This typically happens in Electron/Node when worker threads are being terminated and recreated too rapidly, leading to a race condition in the V8 engine's task runner.

#### Solution:
- Ensure workers are terminated gracefully.
- Add a small delay or check before recreating workers.
- Reuse worker threads where possible instead of full termination/creation cycles.