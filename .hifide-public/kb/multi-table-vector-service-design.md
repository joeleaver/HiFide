---
id: 3fdce3ca-26f3-4164-88bd-ff206ad46216
title: Multi-Table Vector Service Design
tags: [architecture, vector-search, database]
files: [electron/services/vector/VectorService.ts]
createdAt: 2026-01-03T22:28:09.232Z
updatedAt: 2026-01-03T22:28:09.232Z
---

## Vector Service Multi-Table Architecture

The Vector Service has been refactored to support multiple independent tables. This allows for:
1. Different embedding models per table.
2. Independent indexing/cleanup cycles.
3. Specific configuration for Code, Knowledge Base (KB), and Memories.

### Tables
- `code_vectors`: Specialized for code snippets, symbol search, and file structures.
- `kb_vectors`: Designed for natural language knowledge base articles and documentation.
- `memories`: New table for storing agentic context and short/long-term memories.

### Configuration
Each table has its own entry in the `VectorConfig` type, allowing for independent `modelName`, `dimensions`, and `batchSize`.

### Search
The search interface can now query a specific table or merge results from all enabled tables. Result merging uses the similarity score to ensure the most relevant items from across the entire project appear first.
