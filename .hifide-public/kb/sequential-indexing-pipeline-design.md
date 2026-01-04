---
id: 752fc4b0-adf4-4a03-8f3b-20a955a298fc
title: Sequential Indexing Pipeline Design
tags: [indexing, performance, architecture, sequential-processing]
files: [electron/services/vector/CodeIndexerService.ts]
createdAt: 2026-01-04T03:36:34.042Z
updatedAt: 2026-01-04T03:36:34.042Z
---

## Indexing Architecture: Sequential Execution

To improve stability and diagnostic visibility, the indexing pipeline has been shifted from a multi-worker concurrent model to a **sequential worker-offloaded** model.

### Key Changes
- **Single Parser Worker:** Only one parser worker thread is spawned, regardless of CPU count.
- **Sequential Processing:** Files are processed one by one in `CodeIndexerService.indexWorkspace` instead of in concurrent batches.
- **Improved UI Responsiveness:** A `setImmediate` yield is executed after *every* file processed, ensuring the main thread remains responsive even during heavy indexing.

### Reasoning
Concurrent indexing was suspected of causing:
1. IPC saturation between the main process and worker threads.
2. Race conditions during state persistence.
3. Obscured error logs when multiple workers crashed or reported errors simultaneously.

### Verification
When debugging indexing "hangs", logs will now clearly show the specific file being processed before any failure.
