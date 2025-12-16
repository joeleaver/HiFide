---
id: fadba722-a7ee-4b4b-bdc5-f2d3f2b7c749
title: LLM Memory System: Design (short-term, long-term, RAG, storage, safety)
tags: [llm, memory, rag, architecture, flow-engine]
files: []
createdAt: 2025-12-15T21:01:19.817Z
updatedAt: 2025-12-15T21:01:19.817Z
---

## Goal
Provide a memory system that lets LLM calls reliably use:
- **Short-term working memory** (what’s relevant in the current run/session)
- **Long-term memory** (facts/preferences/notes learned across sessions)
- **Contextual recall** (retrieve relevant prior content on demand)

This doc outlines a practical architecture for our Flow Engine/LLMService.

---

## Core principles
1. **Don’t grow the prompt blindly**: keep the conversation window small; add retrieved memory as bounded snippets.
2. **Separate storage from injection**: store anything you want, but only inject what passes retrieval + policy.
3. **Typed, attributable memories**: everything injected should have an origin + timestamp + scope.
4. **User control & privacy**: allow opt-out, deletion, per-project scoping, and redaction.

---

## Memory types (recommended)
### 1) Working set (session memory)
- **Source**: current chat messages + tool outputs + active files/nodes.
- **Storage**: in-memory (already largely handled by Flow context) + persisted session transcript.
- **Usage**: always included (within windowing rules).

### 2) Episodic memory (past events)
- **Examples**: “We tried X and it failed due to Y”, “Decision: use Redis for queue”, “Bug fixed in file Z”.
- **Storage**: chunked documents with metadata, optionally summarized.
- **Retrieval**: semantic search + filters (projectId/sessionId/time).

### 3) Semantic memory (stable facts/preferences)
- **Examples**: user preferences, project conventions, API endpoints, glossary.
- **Storage**: key-value facts + provenance + confidence.
- **Retrieval**: direct lookup + semantic fallback.

### 4) Task/plan memory
- **Examples**: current task goals, acceptance criteria, constraints.
- **Storage**: canonical task objects (e.g., Kanban task) + derived summary.
- **Retrieval**: always include current task summary as a small “task brief”.

---

## Data model (minimum viable)
A single **MemoryItem** type with scopes + metadata, stored in a DB:
- `id`
- `type`: `episodic | semantic | document | summary | preference`
- `scope`: `{ userId, workspaceId, projectId?, sessionId? }`
- `text`: the content to retrieve/inject
- `source`: `{ kind: 'message'|'file'|'tool'|'import', ref, uri?, hash? }`
- `createdAt`, `updatedAt`
- `tags`: string[]
- `privacy`: `{ pii: boolean, userVisible: boolean, retentionDays? }`
- `embedding`: vector (or external reference)

If we need stable facts, add a `Fact` table:
- `key`, `value`, `confidence`, `provenance`, `scope`

---

## Ingestion pipeline
### A) What gets written to memory?
Recommend **two ingestion paths**:
1. **Explicit**: user clicks “Save to memory” or a tool writes a memory item.
2. **Implicit (curated)**: background summarizer promotes items when:
   - a decision is made
   - a preference is stated
   - a solution is verified

### B) When to summarize
- Use **rolling summaries** per session and per task.
- Summaries should be treated as *derived* documents; keep originals.

### C) Chunking
- Chunk size: 300–800 tokens equivalent.
- Add overlap (10–15%) for document-style text.
- Store chunk→document relationships.

---

## Retrieval pipeline (RAG)
At LLM request time:
1. Build a **retrieval query** from:
   - latest user request
   - current task brief
   - optional: file paths/nodes involved
2. Retrieve top-K memory items with:
   - semantic similarity
   - metadata filters (project/session/time)
   - safety filters (PII, userVisible)
3. **Rerank** (optional) using a cheap cross-encoder or LLM-mini.
4. Deduplicate + cap total tokens.
5. Inject as a dedicated message block:

**Recommended prompt shape**:
- System
- Developer
- *Memory* (tool/system-style message, e.g. `"Relevant memory:"`)
- Conversation

Rules:
- Inject <= N tokens (e.g., 800–1500) total memory.
- Include citations: `[memory:<id>]` in the injected text.

---

## Where to integrate (Flow Engine / LLMService)
### Integration points
- **Before formatting payload/messages**: compute retrieval and attach `context.retrievedMemory`.
- **In message formatting**: add a single memory message (not many) so it’s easy to audit.
- **After tool calls**: optionally write tool results to memory via explicit rules.

### Suggested API boundary
`MemoryService` interface:
- `ingest(items: MemoryItemInput[]): Promise<void>`
- `retrieve(query: RetrieveQuery): Promise<MemoryItem[]>`
- `delete(scope, id | predicate): Promise<void>`
- `summarizeSession(sessionId): Promise<void>` (optional)

`RetrieveQuery` includes:
- `text: string`
- `scope`
- `filters: { types?, tags?, timeRange?, projectId?, sessionId? }`
- `limit`, `tokenBudget`

---

## Storage choices
### For local-first apps
- SQLite for metadata + chunks.
- Vector index options:
  - SQLite extensions (if available)
  - embedded vector DB (e.g., LanceDB)
  - external service (Pinecone/Weaviate) if cloud-first

Minimum viable can start with:
- SQLite + embeddings stored as BLOB/JSON + brute-force cosine for small data.
- Upgrade to ANN index when it grows.

---

## Safety, privacy, and control
- Default: **don’t store** sensitive tool outputs unless user opts-in.
- Mark memories as `userVisible` and provide UI to inspect/edit/delete.
- Support **workspace/project scoping** to prevent cross-project leakage.
- Implement retention policies (e.g., 30/90 days).

---

## Evaluation / success criteria
- Retrieval precision: user rarely sees irrelevant memory.
- Prompt growth bounded; latency acceptable.
- Clear provenance and deletion works.
- No cross-project leakage.
