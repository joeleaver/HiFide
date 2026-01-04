---
id: 7cb12c20-a2a4-437d-8561-d9df21270b1b
title: Indexing Performance & UI Responsiveness
tags: [performance, indexing, worker-threads, architecture, troubleshooting]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/parser-worker.js, electron/workers/indexing/discovery-worker.js]
createdAt: 2026-01-04T00:47:24.597Z
updatedAt: 2026-01-04T02:37:04.718Z
---

# Indexing Performance & UI Responsiveness

The indexing system uses a multi-layered worker thread architecture to ensure the UI remains responsive even when processing large codebases.

## Concurrency Architecture

### Worker Pool
The `CodeIndexerService` maintains a pool of `parser-worker.js` instances.
- **Pool Size:** `Math.max(2, os.cpus().length - 1)`. This ensures that parsing tasks can run in parallel across available CPU cores.
- **Task Distribution:** Round-robin allocation of file processing tasks to the available workers.
- **Task Concurrency:** Each batch of files is processed with a concurrency factor of `numWorkers * 4`.

### Offloaded Discovery
File discovery (walking the directory tree and applying ignore rules) is offloaded to a dedicated `discovery-worker.js`. This prevents the main Electron process from hanging during the initial file system scan.

## Performance Optimizations

### State Batching
To minimize disk I/O and serialization overhead, indexing results are batched. The `indexedFiles` state (hashes) is updated once per batch instead of for every file.

### Incremental Indexing
Files are only re-indexed if their MD5 hash has changed since the last run, unless a "Force Re-index" is triggered.

### Resource Management
- Workers are terminated and recreated on `reset()` to prevent memory leaks or zombie processes.
- Memory usage is monitored within workers to ensure they don't exceed sandbox limits.
