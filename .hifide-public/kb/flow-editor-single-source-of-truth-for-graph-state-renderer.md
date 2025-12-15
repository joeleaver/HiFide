---
id: eec2032e-a669-45c2-ae36-5fcc42bd7a5e
title: Flow Editor: single source of truth for graph state (renderer)
tags: [flow-editor, zustand, architecture, hydration]
files: [src/store/flowEditorLocal.ts, src/store/hydration.ts, src/store/flowEditor.ts, src/components/FlowView.tsx]
createdAt: 2025-12-15T17:05:11.174Z
updatedAt: 2025-12-15T17:05:11.174Z
---

## Goal
Avoid component-level hydration `useEffect` patterns and avoid multiple code paths that load/refresh graph state.

## Single source of truth (SoT)
- **Graph (nodes/edges)**: `useFlowEditorLocal` (`src/store/flowEditorLocal.ts`)
  - Hydrates from `workspace.snapshot` via `src/store/hydration.ts`
  - Updates on backend event `flowEditor.graph.changed`
  - Persists via debounced `flowEditor.setGraph` (autosave) *from within the store*
- **Templates + actions**: `useFlowEditor` (`src/store/flowEditor.ts`)
  - Owns templates list + selected template
  - Provides actions like `loadTemplate`, `saveAsProfile`, `deleteProfile`, `createNewFlowNamed`
  - **Does not** fetch graph data (`flowEditor.getGraph`) and does not expose `fetchGraph()`.

## Anti-patterns
- `graphVersion` counters used to trigger component effects ("rehydrate on version bump")
- Component mount `useEffect` that calls `flowEditor.getGraph` / `fetchGraph`
- Duplicate subscriptions to `flowEditor.graph.changed` across multiple stores for the same purpose

## UI input UX note
For hot text inputs (e.g., System Instructions textarea), maintain a local draft state to preserve caret and avoid selection resets when the graph store updates.

## Current state (after consolidation)
- `useFlowEditor.fetchGraph` removed.
- `FlowView` Retry no longer triggers graph fetch; graph comes from snapshot + graph-changed events.

## Related files
- `src/store/flowEditorLocal.ts`
- `src/store/hydration.ts`
- `src/store/flowEditor.ts`
- `src/components/FlowView.tsx`