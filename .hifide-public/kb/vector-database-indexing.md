---
id: e14831f8-0cc2-44b6-a1f7-3b3e5a4f1fbe
title: Vector Database Indexing
tags: [architecture, vector-db, indexing]
files: [electron/services/vector/VectorService.ts, electron/services/vector/CodeIndexerService.ts, electron/services/vector/KBIndexerService.ts, electron/backend/ws/service-handlers.ts]
createdAt: 2026-01-03T19:33:22.794Z
updatedAt: 2026-01-03T19:42:23.556Z
---

## Initialization Flow

The Vector Service must be initialized with a workspace root before indexing or searching. This sets up the LanceDB connection and the embedding model (OpenAI or local @xenova/transformers).

### Atomic Initialization
To prevent race conditions when multiple indexers trigger initialization, the `VectorService` uses an internal `initPromise`.

```typescript
async init(workspaceRoot: string) {
    if (this.state.initialized) return;
    if (this.initPromise) return this.initPromise;
    // ... logic ...
}
```

### Tree-Sitter WASM Loading
Code indexing relies on `web-tree-sitter`. In the Electron main process, the WASM engine and language parsers must be explicitly located:

1.  **Engine**: `Parser.init({ locateFile: () => path_to_web_tree_sitter_wasm })`
2.  **Languages**: `Parser.Language.load(path_to_lang_wasm)`

The engine must be initialized once before any language loading.

## Indexing Process

1.  **Discovery**: Walk workspace for supported file extensions.
2.  **Hashing**: Only re-index files if content hash has changed.
3.  **Chunking**:
    *   **Code**: Split by syntax nodes (classes, functions).
    *   **KB**: Split by markdown headers or paragraph length.
4.  **Embedding**: Generate vectors via selected provider.
5.  **Upsert**: Store in LanceDB table.

## Troubleshooting

- **VectorService not initialized**: Ensure `await vectorService.init(workspaceRoot)` is called at the start of any indexing method.
- **ReferenceError: getWorkspaceService is not defined**: Check imports in `service-handlers.ts`.
- **TypeError: Cannot read properties of undefined (reading 'loadWebAssemblyModule')**: The Tree-Sitter engine WASM failed to load. Verify the path in `CodeIndexerService.getWasmPath('web-tree-sitter')`.