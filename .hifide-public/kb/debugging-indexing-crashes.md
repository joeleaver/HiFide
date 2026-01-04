---
id: 818c0eb9-929e-4d77-83c3-daf58b182410
title: Debugging Indexing Crashes
tags: [debug, indexing, vector-db, crash]
files: [electron/services/vector/VectorService.ts]
createdAt: 2026-01-04T06:04:53.438Z
updatedAt: 2026-01-04T06:04:53.438Z
---

## Debugging Indexing Crashes (Vector Generation vs AST Chunking)

When the application crashes during indexing without clear error logs, it is often due to either:
1. **OOM (Out of Memory)** in worker threads during AST parsing of large files.
2. **Native Crashes** in the embedding service (e.g., ONNX/Transformers.js) or LanceDB.

### Isolation Strategy
To isolate the cause, we can disable the vector generation (embedding) while keeping the AST chunking logic active. This is done by modifying `VectorService.upsertItems` to use zero-vectors instead of calling the embedding model.

#### Procedure:
1. Open `electron/services/vector/VectorService.ts`.
2. Locates the `upsertItems` method.
3. Set `const DISABLE_EMBEDDING_DEBUG = true;`.
4. This will bypass `embeddingService.embed(item.text)` and use a zero-vector of the correct dimension.

If the crash persists with embeddings disabled, the issue lies in the discovery or AST parsing phase (likely OOM in `parser-worker.js`). If the crash stops, the embedding model or its interaction with the native environment is the culprit.

### Logging
Always add verbose console logs before and after embedding attempts to track the exact item causing a failure.
