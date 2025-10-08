# Retrieval and Indexing

Goal: present entire repos as on-demand context without blowing the model context window.

## Indexing pipeline (background)
- Parse files by language; prefer tree-sitter for ASTs and symbol extraction.
- Create per-file and per-symbol summaries.
- Embed raw chunks and summaries (choose a code-capable embedding model).
- Store in a local vector DB (sqlite-vss/pgvector/FAISS) with metadata (path, lang, symbols).
- Build an import/dependency graph by language.
- Watch mode: incrementally update on file changes.

## Retrieval at inference time
1. Convert task into queries (semantic + keyword). 
2. Top-K semantic search over summaries; then expand via dependency graph (imports, nearest tests, docs).
3. Deduplicate and budget with a scorer (similarity, centrality, size).
4. Provide short summaries first; fetch raw code chunks only when needed.

## UI affordances
- “Working set” side panel showing files the agent currently considers.
- Click to open file and show diff previews for edits.

## Status
- Not yet implemented; this doc defines the design to build next.

