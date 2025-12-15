---
id: d5a8c719-aba6-41a7-8ad8-bcd101a476c3
title: Flow Editor architecture: renderer-local graph store, hydration, and safe node config editing
tags: [flow-editor, architecture, state-management, ux]
files: [src/store/flowEditorLocal.ts, src/store/flowEditor.ts, src/components/FlowCanvasPanel.tsx, src/components/FlowNode/index.tsx, src/components/FlowNode/NodeConfig.tsx, src/components/FlowNode/configSections/DefaultContextConfig.tsx, src/components/FlowNode/configSections/NewContextConfig.tsx]
createdAt: 2025-12-15T16:54:58.540Z
updatedAt: 2025-12-15T16:54:58.540Z
---

## Context
The Flow Editor maintains a renderer-local graph state (`useFlowEditorLocal`) for responsive editing and debounced persistence to the main process. Template metadata is managed separately (`useFlowEditor`).

## Renderer graph state (single source of truth)
- Store: `src/store/flowEditorLocal.ts`
- Holds `nodes`, `edges`, and `isHydrated`.
- Auto-saves to backend via debounced `flowEditor.setGraph` (500ms) after hydration.
- Hydration comes from `flowEditor.getGraph` and is guarded by signatures to avoid clobbering newer local edits.
- Subscribes to `flowEditor.graph.changed` events and selectively re-hydrates.

## Template state
- Store: `src/store/flowEditor.ts`
- Holds `availableTemplates`, `templatesLoaded`, `selectedTemplate`, and `graphVersion` (legacy signal).

## Node config editing
- `src/components/FlowCanvasPanel.tsx` reads `nodes/edges` from `useFlowEditorLocal` and passes per-node handlers via `node.data`:
  - `onConfigChange(nodeId, patch)` merges `patch` into `node.data.config` and updates the local store.
- `src/components/FlowNode/index.tsx` receives handlers from `node.data` and forwards config patches from config UIs.

## UX pitfalls
Because `ReactFlow` receives a new `nodes` array on each config keystroke, node components can re-render frequently. Controlled `<textarea value={...}>` fields can lose caret/selection if the underlying node object is replaced or if hydration/snapshots re-apply values.

## Recommended patterns
- Avoid backend hydration overwriting `nodes` while the user is actively typing (or only hydrate when signatures differ).
- In node config components, prefer local draft state for multiline text fields with commit-on-blur or debounce, or ensure the same node object identity is preserved for unaffected nodes.
- Keep a single graph store entrypoint (prefer `useFlowEditorLocal`) and avoid parallel graph hydration paths (`useFlowEditor.fetchGraph/graphVersion`) where possible.
