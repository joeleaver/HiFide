---
id: fa3d487b-01e2-4e08-9449-533b80ea7f63
title: Vector Search Debugging and Sorting Notes
tags: [vector-search, sorting, lancedb]
files: [electron/services/vector/VectorService.ts]
createdAt: 2026-01-03T21:54:49.178Z
updatedAt: 2026-01-03T22:05:15.536Z
---

Vector search results are now sorted by the highest similarity score (descending) in `VectorService.ts`. 

The score is calculated as `1 - distance` (where distance is the L2/Cosine distance from LanceDB). 

### Implementation Details:
- Sorting occurs after mapping the raw results to the UI-friendly `VectorResult` format.
- `processed.sort((a, b) => b.score - a.score)` ensures the most relevant results appear at the top.
- The `VectorService` uses `.toArray()` for efficient result materialization.