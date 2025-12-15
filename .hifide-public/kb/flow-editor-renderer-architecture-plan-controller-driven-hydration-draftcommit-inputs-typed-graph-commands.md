---
id: 8714a8c1-037b-44a1-a8bf-48b3c26d3672
title: Flow Editor (renderer) architecture plan: controller-driven hydration + draft/commit inputs + typed graph commands
tags: [flow-editor, architecture, zustand, ux]
files: [src/store/flowEditorLocal.ts, src/components/FlowCanvasPanel.tsx, src/store/flowEditorScreenController.ts, src/hooks/useDraftField.ts]
createdAt: 2025-12-15T17:17:55.018Z
updatedAt: 2025-12-15T17:35:49.946Z
---

## Flow Editor (renderer) architecture plan

### Goals
- Single source of truth for graph: `useFlowEditorLocal` (nodes/edges/isHydrated)
- Minimize component business logic; avoid hydration/version/useEffect patterns.
- Consolidate all graph writes behind a typed command API.

### Completed
#### Phase 1 — Controller-driven hydration/readiness
- Added `src/store/flowEditorScreenController.ts` and wired it in bootstrap.
- FlowView becomes pure; controller moves screen phase to ready when `useFlowEditorLocal.isHydrated` is true.

#### Phase 2 — Draft/commit editing UX
- Added `src/hooks/useDraftField.ts`
- Migrated multiline text inputs (System Instructions, injected messages, moderation patterns, etc.) to draft/commit.

#### Phase 3 — Typed graph mutation API
- Added typed commands in `src/store/flowEditorLocal.ts`:
  - `updateNodeData`, `updateNodeConfig`, `addNode`, `removeNodeById`, `addEdge`, `removeEdgeById`
- Migrated key UI paths in `src/components/FlowCanvasPanel.tsx` to use commands.
- Added tests: `src/store/__tests__/flowEditorLocalCommands.test.ts`

#### Phase 3b — Wrap ReactFlow change-sets behind store API (Completed)
- Added `applyNodeChanges(changes)` and `applyEdgeChanges(changes)` to `useFlowEditorLocal`
- Migrated `FlowCanvasPanel` handlers (`onNodesChange`, `onEdgesChange`) to call store API instead of rewriting arrays.
- Extended tests to cover `applyNodeChanges` and `applyEdgeChanges`.

### Remaining follow-ups (optional)
- Consider typing `LocalFlowNode/LocalFlowEdge` away from `any` by importing shared flow graph types.
- Add invariants/dev warnings for illegal graph writes during hydration.
- Wrap auto-layout writes behind a command (`setNodes` is ok but may be centralized).
