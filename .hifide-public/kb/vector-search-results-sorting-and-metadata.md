---
id: e9dcaa82-9bf1-4a89-b418-4ccdbe46aed7
title: Vector Search Results: Sorting and Metadata
tags: []
files: []
createdAt: 2026-01-03T22:25:03.135Z
updatedAt: 2026-01-03T22:25:03.135Z
---

Vector search results are sorted by `score` in descending order. 
Score calculation: `1 - distance` (where distance is the L2/Cosine distance from LanceDB).
The sorting logic `(a, b) => b.score - a.score` ensures that results with the highest similarity (closest to 1.0) appear at the top.

UI Display:
- Search results now explicitly show the `filePath` for code results or `kbId` for knowledge base results.
- Distance scores are displayed as `Similarity: (score * 100)%`.