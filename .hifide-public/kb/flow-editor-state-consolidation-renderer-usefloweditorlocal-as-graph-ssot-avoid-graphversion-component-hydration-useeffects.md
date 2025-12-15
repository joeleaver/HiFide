---
id: 9e2afbe3-6b94-4c9d-a9d0-d1e566e50d3c
title: Flow Editor state consolidation (renderer): useFlowEditorLocal as graph SSoT; avoid graphVersion & component hydration useEffects
tags: [flow-editor, state-management, zustand, architecture]
files: [src/store/flowEditorLocal.ts, src/store/flowEditor.ts, src/components/FlowView.tsx, src/store/sessionUi.ts]
createdAt: 2025-12-15T17:03:13.555Z
updatedAt: 2025-12-15T17:03:13.555Z
---

## Goal
Ensure **single source of truth** for Flow Editor graph state (nodes/edges) in the renderer and avoid component-level “hydration” `useEffect` patterns.

## Stores
- **`useFlowEditorLocal`** (`src/store/flowEditorLocal.ts`): owns `nodes`, `edges`, `isHydrated`.
  - Hydrates from main via `flowEditor.graph.changed` and `flowEditor.getGraph`.
  - Debounced-saves to main via `flowEditor.setGraph`.
  - Contains safeguards to skip stale/identical snapshots.
- **`useFlowEditor`** (`src/store/flowEditor.ts`): owns **templates + selection**, and provides RPC action wrappers.

## Anti-pattern removed
- Removed `graphVersion` and `requestGraphHydration()` from `useFlowEditor`.
- Removed `flowEditor.graph.changed → incrementGraphVersion` pattern.

Rationale: a “version bump” is a proxy for a missing data source; it encourages components to run `useEffect(() => hydrate(), [version])`, which duplicates business logic and can create rerender storms and input UX bugs.

## Component guidance
- Components should render from stores and call store actions. Avoid `useEffect` for data loading/hydration.
- Input UX: it is OK to keep **local draft state** for text inputs (caret stability) but do not treat that as “hydration logic”.

## Known remaining uses of useEffect
Some `useEffect` usage for non-business concerns may remain acceptable (e.g., window event listeners, ReactFlow runtime subscriptions). Prefer store-driven subscriptions for business state.
