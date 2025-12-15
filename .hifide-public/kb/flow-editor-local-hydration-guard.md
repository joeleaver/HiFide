---
id: 347f33f0-d92a-4069-9a81-2c93ff9bcce5
title: Flow editor local hydration guard
tags: [flow-editor, state-management, frontend]
files: [src/store/flowEditorLocal.ts, src/store/flowEditorLocalStrategy.ts, src/store/flowEditorLocalTransforms.ts, shared/flowGraph.ts, electron/services/FlowGraphService.ts, electron/backend/ws/event-subscriptions.ts, electron/backend/ws/handlers/flow-editor-handlers.ts, electron/backend/ws/snapshot.ts, src/store/flowEditor.ts]
createdAt: 2025-12-15T15:23:42.948Z
updatedAt: 2025-12-15T16:17:13.015Z
---

### Context
The renderer keeps an editable copy of the flow graph in `useFlowEditorLocal` while the main process stores the last committed graph in `FlowGraphService`. Whenever the renderer saves, the service broadcasts `flowEditor.graph.changed`, which previously triggered a full re-hydration of the local store—even if the incoming nodes/edges were byte-for-byte identical to the local graph. That redundant hydration re-mounted React Flow nodes and caused text inputs (e.g., the default context start system instructions textarea) to reset the caret to the end of the field.

### Design
`flowEditorLocal.ts` now keeps a `graphSignature` string for the latest local nodes/edges. Each time the store mutates nodes or edges we recompute the signature. When a hydration RPC returns, we compute the signature of the incoming graph and skip updating the store when:
1. The store is already hydrated, and
2. The incoming signature matches the local signature.

If the store has not hydrated yet we still mark `isHydrated` even when the graph is empty, ensuring auto-save continues to work without re-mounting the node tree. This comparison prevents the save → hydrate → re-render loop that interrupted typing while preserving remote-change propagation.

### Unsaved-edit protection (2025-12-15)
Typing faster than the 500 ms auto-save window meant the backend often returned the *previous* saved snapshot, which caused React Flow to remount nodes and jump the caret even though the data matched the last save. The store now tracks both the current local signature and the most recently saved signature. During hydration we:

- Skip when the backend snapshot matches the local signature (unchanged graph)
- Skip when the backend snapshot only matches the last saved signature while the local signature has diverged (local edits newer than the save)

This keeps multiple renderer windows in sync without ever reloading the canvas while the user is mid-edit.

### Runtime-field stripping (2025-12-15)
React Flow injects transient fields (e.g., `__rf`, `selected`, runtime status/style data) that mutate on every keystroke and previously caused signature mismatches. `flowEditorLocalTransforms.ts` now sanitizes nodes and edges before computing signatures or sending them to the backend. The sanitizer clones each node/edge, removes runtime-only node props plus execution/status data inside `data`, and fingerprints the sanitized snapshot. Auto-save sends the sanitized snapshot to `flowEditor.setGraph`, so the backend never replays React Flow internals, and hydration compares canonical graphs that only include persistent authoring data. This stops save→hydrate churn from reloading the canvas or resetting caret/viewport state.

### Reason-scoped hydrations (2025-12-15)
`shared/flowGraph.ts` defines canonical `FlowGraphChangeReason` values plus `shouldHydrateFlowGraphChange`. `FlowGraphService.setGraph` now tags every `flowGraph:changed` event with a reason (`workspace-snapshot`, `template-load`, `autosave`, etc.), and the renderer only hydrates when the reason indicates a true reload trigger (initial workspace load, switching flows, or session-driven graph swaps). Autosave echoes register as `reason: 'autosave'`, so both `flowEditorLocal` and `flowEditor` simply ignore the notification rather than fetching nodes/edges again. This prevents the save → hydrate loop entirely while keeping intentional graph reloads functional.