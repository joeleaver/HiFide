---
id: 6d48e5ba-523d-4038-924b-0cff6fea8b6e
title: Memories: Extraction Types (per-node config)
tags: [memories, ux, rag, flow-engine, storage]
files: [electron/flow-engine/nodes/extractMemories.ts, src/components/FlowNode/configSections/ExtractMemoriesConfig.tsx, src/components/MemoriesView.tsx, electron/backend/ws/handlers/memories-handlers.ts]
createdAt: 2025-12-15T23:19:33.404Z
updatedAt: 2025-12-15T23:25:56.817Z
---

## Summary
Memory extraction type toggles (decision/constraint/preference/fact/warning/workflow) are configured on the **`extractMemories` flow node**.

They control what the extractor is allowed to **write** to the workspace memory store.

## Behavior
- If a type is disabled on the node (e.g. `warning=false`), any extracted candidates of that type are **skipped** (not created/merged).
- This does **not** delete existing memories of that type.
- This is independent from the per-memory-item **Enabled** flag:
  - `enabled=false` on a memory item prevents it from being used during **retrieval/injection (RAG)**.

## Configuration
Node config fields:
- `provider`, `model`
- `lookbackPairs`
- `enabledTypes`: object map of `{ [type]: boolean }` (defaults to all enabled).

## Implementation notes
- The node filters LLM-extracted items by `enabledTypes` before calling `applyMemoryCandidates`.
- Settings are not managed from the global Memories screen.

## Files
- `electron/flow-engine/nodes/extractMemories.ts`
- `src/components/FlowNode/configSections/ExtractMemoriesConfig.tsx`
- `src/components/MemoriesView.tsx`
- `electron/backend/ws/handlers/memories-handlers.ts`
