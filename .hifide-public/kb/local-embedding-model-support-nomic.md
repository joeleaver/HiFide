---
id: 9c60de36-2336-42e0-a3de-437437244080
title: Local Embedding Model Support (Nomic)
tags: [embeddings, nomic, local-ai]
files: []
createdAt: 2026-01-03T23:47:15.325Z
updatedAt: 2026-01-03T23:48:57.728Z
---

# Local Embedding Model Support (Nomic)

## Feature Overview
The system now supports multiple local embedding models via `@xenova/transformers`, including the Nomic Embed series which provides higher dimensionality (768) and better retrieval performance compared to the default MiniLM.

## Configuration
The `EmbeddingService` dynamically loads models based on the `settings.vector.localModel` path.

- **Option 1 (Default):** `Xenova/all-MiniLM-L6-v2` (384 Dimensions)
- **Option 2 (Nomic):** `nomic-ai/nomic-embed-text-v1.5` (768 Dimensions)

## Automatic Integration
When a model is selected in the UI:
1. `SettingsService` maps the UI label to the correct HuggingFace model ID.
2. `EmbeddingService` initializes the new transformer pipeline on the next indexing run.
3. If changing models, the vector database tables need to be cleared/re-indexed because vector dimensions are mismatched between models.

## User Interface
The selection is available in the **Settings > Vector Search** pane under the "Embedding Model" dropdown for each table (Code, KB, Memories).
