---
id: e5f17e80-480b-498a-8015-75a4c6d0c011
title: Debugging Indexing Worker Crashes
tags: [crash, architecture, ipc]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/discovery-worker.js]
createdAt: 2026-01-04T06:25:08.438Z
updatedAt: 2026-01-04T06:25:08.438Z
---

## Worker Crash Summary (Native Crash: !flush_tasks_)

**Symptoms:**
- Error: `[58616:0103/232229.567:ERROR:crashpad_client_win.cc(868)] not connected`
- Exit Code: `4294930435`
- Timing: Usually occurs during transition from Discovery to Indexing, or when `IndexOrchestrator` resets the state.

**Root Cause Analysis:**
The crash is likely an Electron/Node.js native crash in the rendering/base thread logic (`!flush_tasks_` or similar cleanup failures). It occurs when `Worker` threads are rapidly spawned, communicated with via `postMessage`, and then terminated. Specifically, when `DiscoveryWorker` sends massive file lists (e.g., thousands of paths) back to the main thread via IPC, it can saturate the message loop. If the workers are terminated while the pipe is still full or processing, the native layer fails to clean up handles, leading to the "not connected" crash.

**Interim Mitigation:**
1. **Discovery Bottleneck:** `DiscoveryWorker` sending absolute paths in large chunks over JSON-RPC.
2. **IPC Saturation:** Moving discovery and parsing off IPC to a more robust mechanism (Direct Memory via `SharedArrayBuffer` or more likely a local socket/server).

**Architecture Migration (Planned):**
Migrating `CodeIndexerService` to use a `SharedArrayBuffer` for the file list or a dedicated indexing orchestrator that doesn't rely on the Electron main process's primary IPC bus.
