---
id: dd057336-c096-4b00-a69f-a56698814ea6
title: Vector Search & Indexing Service Architecture
tags: [architecture, vector-db, semantic-search, rag, services, zustand]
files: [electron/services/vector/VectorService.ts, electron/services/vector/EmbeddingService.ts, electron/services/vector/CodeIndexerService.ts, electron/services/vector/KBIndexerService.ts, src/store/vectorStore.ts, electron/services/index.ts, electron/utils/fileDiscovery.ts]
createdAt: 2026-01-03T21:13:17.324Z
updatedAt: 2026-01-03T21:13:52.077Z
---

## Vector Search & Indexing Service Architecture

The Vector Search system provides semantic search capabilities across code and Knowledge Base articles using LanceDB (WASM version) and local embeddings (via MiniLM 384-dimension model) or OpenAI (1536-dimension).

### Core Components

- **VectorService (`electron/services/vector/VectorService.ts`)**: The central entry point for database operations. It handles LanceDB connections, table creation, schema validation, and search/upsert operations.
  - **Self-Healing**: Automatically detects dimension mismatches (e.g., after switching embedding models) and purges/recreates the table.
  - **Status Aggregation**: Tracks indexing progress across multiple sources (`code`, `kb`) and reports a unified progress state to the UI.
- **EmbeddingService (`electron/services/vector/EmbeddingService.ts`)**: Manages the generation of embedding vectors. It abstract the provider-specific logic (OpenAI vs. Local) and handles model loading/dimensionality.
- **CodeIndexerService (`electron/services/vector/CodeIndexerService.ts`)**: Discovers project files and chunks them using Tree-Sitter (native bindings) for semantic metadata extraction (classes, functions, etc.).
- **KBIndexerService (`electron/services/vector/KBIndexerService.ts`)**: Indexes Knowledge Base articles using a sliding-window markdown chunker for high semantic density.
- **VectorStore (`src/store/vectorStore.ts`)**: Zustand store for frontend state and actions, ensuring UI reactivity and decoupling from backend RPC logic.

### Lifecycle

1. **Service Initialization**: Services are created in `electron/services/index.ts`.
2. **Workspace Bound Init**: `VectorService.init(path)` is called when a folder is opened in `WorkspaceService`.
3. **Lazy Engine Load**: Tree-Sitter and Embedding models are loaded on-demand before indexing begins.
4. **Search Gating**: All search/upsert operations are gated by `ensureInitialized()` in `VectorService`.

### Database Schema (LanceDB)

Flattened metadata columns for high-performance SQL filtering:
- `id`: Unique string (`type:path:lineNumber` or `type:kbId:chunkIndex`)
- `vector`: Float32 array (384 or 1536 dimensions)
- `text`: Raw text content
- `type`: 'code' | 'kb' | 'memory'
- `filePath`: Relative project path
- `symbolName`: Function/Class name
- `symbolType`: 'class' | 'function' | 'method' etc.
- `kbId`: KB article UUID
- `articleTitle`: KB article title
- `metadata`: JSON blob for extended fields

### Path & Discovery Utilities
- **discoverWorkspaceFiles**: Specialized tool in `electron/utils/fileDiscovery.ts` for consistent file mapping across tools.
