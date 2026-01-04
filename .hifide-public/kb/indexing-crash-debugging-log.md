---
id: 247b8b85-a2ee-4504-ab31-bd01ae011e63
title: Indexing Crash Debugging Log
tags: [troubleshooting, indexing, crash]
files: [electron/workers/indexing/parser-worker.js, electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T06:06:33.513Z
updatedAt: 2026-01-04T06:06:33.513Z
---

## Troubleshooting Indexing Crashes

The indexing process for the code database has been experiencing crashes and hangs. We are currently performing isolation testing to identify the root cause.

### Hypothesis 1: AST-Based Chunking
AST-based chunking uses `tree-sitter` which involves native bindings. These bindings can sometimes cause segfaults or memory issues when processing certain files or during high concurrency in worker threads.

**Test Status:** 
- In Progress: AST-based chunking has been temporarily disabled by forcing the parser check to `false` in `electron/workers/indexing/parser-worker.js`.
- If the crash persists, it confirms that the issue lies in the discovery, file I/O, or worker communication logic rather than the tree-sitter parsing itself.

### Observation: Native Crashes on Windows
On Windows, rapid worker termination or pipe saturation (stdout/stderr) has been known to cause native crashes in Electron/Node.js.

- **Mitigation 1:** `stdout/stderr` have been disabled for workers in `CodeIndexerService.ts` to prevent pipe saturation.
- **Mitigation 2:** A 500ms delay was added before final worker cleanup after an exit event.
- **Mitigation 3:** Batch size for indexing was set to `1` to isolate whether concurrency triggers the crash.

### Current Work-in-Progress
- Task: **Verify AST chunking as crash root cause** (task-a56f0306-f240-497c-b1d5-389fa5e1c03f)
- Manual check: Re-run indexing with `if (false && parser)` and monitor for crashes.