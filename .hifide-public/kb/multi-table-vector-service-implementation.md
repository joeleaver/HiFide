---
id: e481a129-81ef-4b47-9606-3494e4acc011
title: Multi-Table Vector Service Implementation
tags: [architecture, vector-search, database, multi-table]
files: [electron/services/vector/VectorService.ts, src/SettingsPane.tsx]
createdAt: 2026-01-03T22:28:34.338Z
updatedAt: 2026-01-04T00:18:29.172Z
---

# Multi-Table Vector Service Implementation

The Vector Service manages vector databases using LanceDB to support semantic search across code, knowledge base, and memories.

## Storage
- **Location:** `.hifide-private/vectors`
- **Tables:**
  - `code_vectors`: Embeddings for code snippets and symbols.
  - `kb_vectors`: Embeddings for Knowledge Base articles.
  - `memory_vectors`: Embeddings for short/long term AI memories.

## Model Support
The service supports multiple embedding models, including:
- **Local:** `all-MiniLM-L6-v2` (384d)
- **Local:** `nomic-ai/nomic-embed-text-v1.5` (768d) - *Recommended for code*
- **Cloud:** OpenAI `text-embedding-3-small` (1536d) / `large` (3072d)

## Per-Table Configuration
Each table can be configured with a different embedding model. The `VectorService` handles dimension mismatches automatically by tracking the expected dimension for each table.

## Implementation Details
- **Lazy Initialization:** Tables are opened or created only when first accessed.
- **Dimension Validation:** On open, the service checks the table's vector dimension against the active model. If they mismatch, the table is dropped and recreated to prevent runtime errors.
- **Case-Sensitivity:** All SQL filters use double-quoted identifiers (e.g., `"filePath"`) to satisfy LanceDB/DataFusion's case-sensitivity requirements.
- **Non-Blocking:** Heavy embedding operations are offloaded to a background Worker Thread.
