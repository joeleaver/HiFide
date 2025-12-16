---
id: c09ff81c-ea66-40b1-be5d-88e999038ab5
title: Workspace Memories (Long-term RAG): memories.json format + retrieval + UX screen plan
tags: [llm, memory, rag, design, workspace-scope, ux, dedupe]
files: [electron/store/utils/workspace-helpers.ts, electron/store/utils/memories.ts, electron/backend/ws/handlers/memories-handlers.ts, electron/backend/ws/handlers/index.ts, electron/backend/ws/server.ts, electron/flow-engine/nodes/extractMemories.ts, electron/flow-engine/nodes/index.ts, src/components/NodePalettePanel.tsx, src/components/FlowNode/NodeConfig.tsx, src/components/FlowNode/configSections/ExtractMemoriesConfig.tsx, shared/node-colors.ts, shared/hydration.ts, electron/store/types.ts, src/components/ActivityBar.tsx, src/components/MemoriesView.tsx, src/App.tsx, electron/flow-engine/nodes/__tests__/extractMemories.test.ts]
createdAt: 2025-12-15T21:08:53.706Z
updatedAt: 2025-12-15T22:02:12.671Z
---

# Workspace Memories (Long-term RAG): memories.json format + retrieval + UX screen plan

## Status
- Store + deterministic dedupe: implemented
- `extractMemories` node: implemented
- Memories UI + CRUD RPC: implemented
- **RAG usage (retrieval/injection): implemented (v1)**

## Storage
- Workspace-scoped JSON: `.hifide-public/memories.json`
- Utilities: `electron/store/utils/memories.ts`

## Deterministic dedupe
- Exact: `contentHash` (sha256(normalized text))
- Similar: Jaccard token overlap + small boosts

## Extraction node
- Node: `electron/flow-engine/nodes/extractMemories.ts`
- Provider/model configurable per-node
- Input: last `lookbackPairs` user/assistant pairs from `context.messageHistory`
- Output: pass-through; side effect writes to store

## Memories UI
- `src/components/MemoriesView.tsx`
- RPC: `electron/backend/ws/handlers/memories-handlers.ts`

## Retrieval / Injection (RAG usage)
Implemented in `electron/flow-engine/nodes/llmRequest.ts` (v1):
- Before LLM call, retrieve top memories for the current user message using lexical similarity:
  - `retrieveWorkspaceMemoriesForQuery(message, { maxItems: 8, maxChars: 2400 })`
- Inject into `systemInstructions` as a "## Relevant workspace memories" section.
- Mark memories used (`lastUsedAt`, `usageCount`) via `markMemoriesUsed`.

Notes:
- This is **workspace-scoped** via `flow.workspaceId`.
- Dedupe and retrieval currently do not use embeddings; purely deterministic lexical scoring.
