---
id: b46bb2e8-bf8f-4159-86dc-855aea435307
title: Vector Search Debugging Notes
tags: [vector-search, debug, lancedb]
files: [electron/services/vector/VectorService.ts]
createdAt: 2026-01-03T21:54:00.506Z
updatedAt: 2026-01-03T21:54:00.506Z
---

# Vector Search Debugging

Detailed logs have been added to `VectorService.search` to diagnose hanging or empty result issues. 

## Search Lifecycle
1. `getOrCreateTable()` ensures the connection and schema.
2. `getEmbeddingService().embed(query)` generates the vector.
3. `queryBuilder` is initialized and configured with `cosine` metric and filters.
4. `queryBuilder.execute()` is called.

## Recent Logging Changes
Additional logs now track the query builder state and the raw result count from LanceDB to determine if the issue is in the search execution or post-processing.

- `[VectorService] Query builder initialized`
- `[VectorService] Metric set to cosine`
- `[VectorService] Executing LanceDB query...`
- `[VectorService] LanceDB returned X results`

Associated File: `electron/services/vector/VectorService.ts`