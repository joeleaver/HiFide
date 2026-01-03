---
id: bbee93d3-d132-4a8b-bd38-d8a0dac73376
title: Vector Database & Semantic Search Integration Plan
tags: [vector-db, semantic-search, rag, architecture, plan]
files: []
createdAt: 2026-01-03T06:38:24.896Z
updatedAt: 2026-01-03T06:51:47.598Z
---

## Goal
Enhance search capabilities across code, knowledge base (KB), and memories by integrating a local vector database for semantic search. This will complement existing ripgrep-based search.

## Proposed Architecture

### 1. Vector Database
- **Choice**: [LanceDB](https://lancedb.com/)
  - Why: Local-first, lightweight, persists to disk as fragments (easy for Electron apps), supports serverless/embedded modes, and has a strong Node.js/TypeScript SDK.
- **Storage**: `.hifide/vectors` or a similar hidden directory in the workspace.

### 2. Embedding Model
- **Choice**: [node-fastembed](https://github.com/Anush008/node-fastembed)
- **Model**: `all-MiniLM-L6-v2` (flagship model for efficiency and performance).
- **Why**: Local, fast, CPU-efficient, no API cost, and privacy-preserving. Enables fully offline semantic search.

### 3. Ingestion & Indexing
- **Multi-Language Code Indexing (AST-based)**:
  - **Core Parser**: Use [tree-sitter](https://tree-sitter.github.io/tree-sitter/) for robust AST parsing across multiple languages.
  - **Supported Languages**: TypeScript (TS), JavaScript (JS), Go, Rust, Python, and other top-tier languages.
  - **Chunking Strategy**:
    - **Classes/Structs**: Include name, documentation/comments, and signature.
    - **Methods/Functions**: Include name, parameters, return type, comments, and body content.
    - **Interfaces/Traits/Types**: Capture definitions and implementation signatures.
  - Metadata per chunk: `filePath`, `startLine`, `endLine`, `symbolName`, `parentSymbol`, `language`, `hash`.
- **Knowledge Base Indexing**:
  - Chunk by Markdown headers (H1, H2, H3).
  - Metadata: `kbId`, `title`, `tags`, `filePath`.
- **Memory Indexing**:
  - Index episodic and semantic memories (refer to `LLM Memory System` design).

### 4. Search Pipeline (workspaceSearch)
Enhance `workspaceSearch` to follow this sequence:
1. **Semantic Search**: Query LanceDB for top-K matches based on the embedding of the user query (generated via `node-fastembed`).
2. **Score Threshold**: If matches have high confidence (> 0.7 or similar), return them.
3. **Ripgrep Fallback**: If semantic search is inconclusive or returns zero results, fall back to the existing literal/regex ripgrep search.
4. **Path/Tokenized Fallback**: Continue with existing fallbacks if ripgrep also fails.

### 5. Implementation Roadmap
1. **Infrastructure**: Add `lancedb` and `node-fastembed` dependencies. Set up `VectorService`.
2. **Multi-Language Indexing**: Implement `CodeIndexerService` using `tree-sitter` bindings.
3. **KB Indexing**: Implement `KBIndexerService`.
4. **Tool Integration**: Update `searchWorkspace.ts` to use `VectorService`.
5. **UI/UX**: Add status indicator for "Indexing..." and ensure results show "Semantic Match" badge.

## Integration Points
- `electron/services/VectorService.ts` (New)
- `electron/services/CodeIndexerService.ts` (New)
- `electron/tools/workspace/searchWorkspace.ts` (Modified)
- `electron/services/WorkspaceSearchService.ts` (Modified)
