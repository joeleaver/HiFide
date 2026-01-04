---
id: f0741f6a-f878-4049-a789-4af8fa691e2a
title: Debugging JSON-RPC 'reconnecting' and 'no-workspace' crashes
tags: [debug, json-rpc, hydration, crash]
files: [src/lib/backend/client.ts, src/store/explorer/base.ts, src/store/explorerScreenController.ts]
createdAt: 2026-01-04T02:54:44.440Z
updatedAt: 2026-01-04T02:54:44.440Z
---

## JSON-RPC Reconnect Safety & Hydration Race Conditions

### Issue: Reconnecting Errors During App Boot
The `json-rpc-2.0` library can throw a "reconnecting" error if a request is made while the socket is unstable or if `rejectAllPendingRequests('reconnecting')` is called during a subscription re-attach.

### Fix: Persistent Subscription Strategy
In `BackendClient.subscribe`, we removed the explicit `rejectAllPendingRequests('reconnecting')` call. The library handles request rejections naturally when the connection is lost. Forcefully rejecting them during handler registration was causing race conditions where initial boot requests (like `explorer.getState`) were aborted even if the socket was technically ready.

### Issue: 'no-workspace' Crash
The `explorer` hydration requires a `workspaceRoot`. If `hydrate()` is called before the backend has fully signaled `workspace.attached`, it throws `Workspace not attached`.

### Solution: whenReady Wait
All critical hydration paths (like `explorerScreenController`) now use `await client.whenReady(5000)` before initiating RPC calls. This ensures the JSON-RPC handshake is complete.

### Native Crash (Exit Code 4294930435)
This exit code usually indicates a native exception (often in Electron logic or a native node module like LanceDB/Tree-sitter). While the JS-level "reconnecting" error isn't the direct cause of the native crash, the resulting unhandled promise rejections and rapid state transitions can trigger race conditions in native worker thread management. Cleaning up the RPC lifecycle reduces this churn.