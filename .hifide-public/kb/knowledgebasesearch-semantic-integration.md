---
id: 20edf636-e089-4ddd-8f10-cb3035f60822
title: KnowledgeBaseSearch Semantic Integration
tags: [semantic-search, knowledge-base, vector-db, rag]
files: [electron/tools/kb/search.ts]
createdAt: 2026-01-03T23:42:51.616Z
updatedAt: 2026-01-03T23:43:51.111Z
---

# KnowledgeBaseSearch Semantic Integration

The `knowledgeBaseSearch` tool now supports multi-stage search, integrating both traditional keyword matching and semantic vector searching.

## Implementation Details

The tool is implemented in `electron/tools/kb/search.ts` and follows this logic:

1. **Keyword/Tag Search**: It first queries the standard knowledge base store for exact tag matches and tokenized text matches.
2. **Semantic Fallback**: If the query is non-empty and the initial results are fewer than the requested `limit`, it performs a semantic search using the `VectorService` against the `kb` table.
3. **Merging**: Results from both stages are merged, ensuring no duplicate entries are returned.

## Model Usage

The tool's description has been updated to inform the LLMs of this behavior:
> Search the project Knowledge Base for documentation. This tool uses a multi-stage search: it first performs a keyword/tag match and then falls back to a semantic vector search if results are sparse. Effectively handles natural language questions and multi-word queries.

## Vector Table

Semantic searching for the knowledge base utilizes the `kb` table in the local vector database. Embeddings are generated for the body content of the KB articles.

## Files
- `electron/tools/kb/search.ts`
- `electron/services/vector.ts` (via VectorService)
