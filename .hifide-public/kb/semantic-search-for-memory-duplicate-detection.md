---
id: a297755c-560a-45e1-8f13-4a3265431a83
title: Semantic Search for Memory Duplicate Detection
tags: [memory, vector-search, semantic-search, deduplication, rag]
files: [electron/store/utils/memories.ts, electron/flow-engine/nodes/extractMemories.ts, electron/services/vector/VectorService.ts]
createdAt: 2026-01-04T00:26:05.100Z
updatedAt: 2026-01-04T00:26:05.100Z
---

## Semantic Search for Memory Duplicate Detection

To prevent duplicate or redundant memories when using the `extractMemories` node, we leverage semantic search via `VectorService`.

### Logic Flow

1.  **Extraction:** The LLM suggests candidate memories.
2.  **Filtering:** Candidates are filtered by enabled types.
3.  **Deduplication:**
    *   **Level 1: Exact Match.** Content hash (SHA-256) check against existing local memory store.
    *   **Level 2: Semantic Similarity.** Query the vector database (LanceDB) `memory_vectors` table using the candidate text.
    *   **Collision Detection:** If a result returns with a similarity score above the threshold (default: `0.85`), the candidate is considered a duplicate and is used to update the existing memory's metadata (tags, importance) instead of creating a new entry.

### Configuration

*   **Similarity Threshold:** Controlled by `opts.similarityThreshold` in `applyMemoryCandidates`. Default is `0.85` for semantic search.
*   **Vector Table:** `memory_vectors`.

### Dependencies

*   `VectorService`: Provides `search` and `upsertItems` capabilities.
*   `EmbeddingService`: Used for generating query vectors.
*   `MemoriesIndexerService`: Ensures the local store stays in sync with the vector database.
