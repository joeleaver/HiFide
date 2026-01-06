---
id: 9c60de36-2336-42e0-a3de-437437244080
title: Local Embedding Model Support (Nomic)
tags: [embeddings, nomic, local-ai]
files: []
createdAt: 2026-01-03T23:47:15.325Z
updatedAt: 2026-01-04T17:57:51.859Z
---

# Local Embedding Model Support (Nomic)

## Feature Overview
The system now supports multiple local embedding models via `@huggingface/transformers` v3, including the Nomic Embed text model which provides higher dimensionality (768) and better retrieval performance compared to the default MiniLM.

## Configuration
The `EmbeddingService` dynamically loads models based on the `settings.vector.localModel` path.

- **Option 1 (Default):** `Xenova/all-MiniLM-L6-v2` (384 Dimensions) - Fast and lightweight
- **Option 2 (Nomic Text):** `nomic-ai/nomic-embed-text-v1.5` (768 Dimensions) - Higher quality embeddings

> **Note:** `nomic-ai/nomic-embed-code` is not available for local inference as it is a 7B parameter model without ONNX support. Use the text model for code as well - it works well for code retrieval.

## Automatic Integration
When a model is selected in the UI:
1. `SettingsService` maps the UI label to the correct HuggingFace model ID.
2. `EmbeddingService` initializes the new transformer pipeline on the next indexing run.
3. If changing models, the vector database tables need to be cleared/re-indexed because vector dimensions are mismatched between models.

## User Interface
The selection is available in the **Settings > Vector Search** pane under the "Embedding Model" dropdown for each table (Code, KB, Memories).
