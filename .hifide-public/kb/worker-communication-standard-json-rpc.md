---
id: 2ebd09ec-be44-4d2b-88ac-3c58ab4a46c5
title: Worker Communication Standard (JSON-RPC)
tags: [worker-threads, json-rpc, architecture]
files: [electron/services/vector/CodeIndexerService.ts, electron/workers/indexing/discovery-worker.js, electron/workers/indexing/parser-worker.js]
createdAt: 2026-01-04T06:21:18.290Z
updatedAt: 2026-01-04T06:21:57.219Z
---

## Worker Communication with JSON-RPC

To standardize communication between the main process (Electron) and worker threads, we use the `json-rpc-2.0` library. This replaces ad-hoc `postMessage` calls with a request/response pattern and type-safe notifications.

### Architecture

1.  **Transport**: We wrap `parentPort` (in worker) and `Worker` instance (in main) to satisfy the `json-rpc-2.0` transport requirements.
2.  **Server/Client**: Each side can act as both a server (handling incoming requests/notifications) and a client (sending requests/notifications).

### Implementation Pattern

#### In the Worker Thread:
```typescript
import { parentPort } from 'node:worker_threads';
import { JSONRPCServer, JSONRPCClient, JSONRPCServerAndClient } from 'json-rpc-2.0';

const serverAndClient = new JSONRPCServerAndClient(
  new JSONRPCServer(),
  new JSONRPCClient((payload) => parentPort.postMessage(payload))
);

parentPort.on('message', (payload) => serverAndClient.receiveAndSend(payload));

// Handle requests
serverAndClient.addMethod('myMethod', async ({ param1 }) => {
  return await doWork(param1);
});
```

#### In the Main Process:
```typescript
import { Worker } from 'node:worker_threads';
import { JSONRPCServer, JSONRPCClient, JSONRPCServerAndClient } from 'json-rpc-2.0';

const worker = new Worker('worker.js');
const serverAndClient = new JSONRPCServerAndClient(
  new JSONRPCServer(),
  new JSONRPCClient((payload) => worker.postMessage(payload))
);

worker.on('message', (payload) => serverAndClient.receiveAndSend(payload));

// Call worker
const result = await serverAndClient.request('myMethod', { param1: 'value' });
```

### Registered Workers
- `CodeIndexerService`
  - `discovery-worker.js`: Handles file system discovery. Methods: `discover`. Notifications: `discovery-chunk`, `discovery-progress`.
  - `parser-worker.js`: Handles AST parsing and chunking. Methods: `parse`.
