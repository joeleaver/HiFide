---
id: 779e4aa4-75aa-40e9-9198-db941d17ffaa
title: Flow editor autosave data-flow audit
tags: [flow-editor, audit, state-management]
files: [src/store/flowEditorLocal.ts, electron/backend/ws/handlers/flow-editor-handlers.ts, electron/services/FlowProfileService.ts, electron/services/flowProfiles.ts]
createdAt: 2025-12-15T16:45:59.446Z
updatedAt: 2025-12-15T16:45:59.446Z
---

## Current event path
1. The renderer keeps live nodes/edges in `useFlowEditorLocal`. Every keystroke updates that store and schedules a debounced call to `flowEditor.setGraph`.
2. `flowEditor.setGraph` updates `FlowGraphService`, which emits `flowGraph:changed` with `reason: 'autosave'`. The renderer now ignores that reason and therefore no longer rehydrates purely because of the event.
3. The handler also calls `FlowProfileService.saveProfile` so the currently-selected template file stays in sync. Even though we pass `reloadTemplates: false`, the service still routes through `listFlowTemplates → loadWorkspaceTemplates`, which rescans `.hifide-public/flows` and hydrates the entire template roster.
4. That rescanning replays `flowProfileService.loadTemplate(...)` in the workspace snapshot builder, which calls `flowGraphService.setGraph(... reason:'workspace-snapshot')`, rehydrating the React Flow canvas, re-running layout, and snapping the cursor/viewport every time the debounce fires.

## UX / data-flow problems
- **Multiple stores for the same graph**: `sessionUi`, `flowEditor`, and `flowEditorLocal` each own overlapping state (templates, selected template, nodes/edges). They are hydrated via separate RPC calls (`workspace snapshot`, `flowEditor.getTemplates`, `flowEditor.getGraph`), which multiplies the chances of race conditions and re-renders.
- **Save → reload loop**: Auto-saving routes through the same `saveProfile` code path as UI-driven Save As. That path assumes we need a full template refresh after every persist, even when the user is just editing the template they already have loaded.
- **Hydration entrypoints**: `hydrateSessionUiSettingsAndFlows` still calls `flowEditor.getGraph` and `flowEditor.getTemplates` on top of the main snapshot, duplicating work and occasionally racing with the renderer’s own flow-editor stores.

## Simplification opportunities
1. **Split persistence from template management** – autosave only needs to write the currently-loaded template file. It should call `saveWorkspaceFlowProfile` / `saveFlowProfile` directly and skip `FlowProfileService.reloadTemplatesFor`. UI actions (Save As/Delete/Import) can continue to reload the roster.
2. **Single graph hydration trigger** – rely on the workspace snapshot plus `flowEditor.graph.changed` for real graph changes. Remove extra `flowEditor.getGraph` calls from `sessionUi` hydrate routines.
3. **Renderer store consolidation** – let `useFlowEditorLocal` own nodes/edges and treat `useFlowEditor` as pure metadata (template list + selection). Remove hidden component-level flows that fetch/rehydrate outside those stores.

## Next steps
- Update `flowEditor.setGraph` to persist via the low-level save helpers instead of `FlowProfileService.saveProfile`, eliminating unnecessary template reloads after each keystroke.
- Add assertion logs (during development) if any autosave path tries to invoke the template reload path.
- Follow up by deduplicating the session/flow hydration routines now that autosave is one-way.
