---
id: 1555924f-0c3b-47dc-a622-927ec332b749
title: Flow editor autosave workspace scoping
tags: [flows, autosave, workspace-scope]
files: [src/store/flowEditorLocal.ts, electron/backend/ws/handlers/flow-editor-handlers.ts, electron/services/FlowProfileService.ts, electron/services/flowProfiles.ts, electron/services/flowAutosave.ts, electron/services/__tests__/flowAutosave.test.ts, electron/services/__tests__/FlowProfileService.test.ts]
createdAt: 2025-12-11T01:16:28.152Z
updatedAt: 2025-12-15T16:50:10.850Z
---

## Overview
Flow edits are managed locally inside `useFlowEditorLocal`. The renderer keeps a real-time graph, debounces RPC calls to `flowEditor.setGraph`, and the backend handler persists the graph via `FlowGraphService` plus optional template writes handled by `FlowProfileService`.

## Workspace scoping
Each renderer connection is bound to a workspace (resolved with `getConnectionWorkspaceId`). Autosave handlers must pass that workspace ID through `flowEditor.setGraph` so `FlowGraphService` and any persistence helpers write into the correct `.hifide-public/flows` directory. `saveWorkspaceFlowProfile`/`deleteWorkspaceFlowProfile` therefore always receive the explicit workspace ID instead of falling back to `process.cwd()`.

## Autosave persistence helper (2025-12-15)
Autosave no longer routes through `FlowProfileService.saveProfile`, which always reloads the full template roster. Instead, `flowEditor.setGraph` calls `persistAutosaveSnapshot` (see `electron/services/flowAutosave.ts`), which writes directly via `saveWorkspaceFlowProfile` or `saveFlowProfile` depending on the template library and skips system templates entirely. This keeps template caches intact while avoiding the save→reload loop that re-mounted the React Flow canvas after every keystroke. Manual Save As/Delete/Import still use `FlowProfileService` so user-driven template changes continue to refresh the roster.

## Autosave reload suppression
`FlowProfileService.saveProfile` still exposes an optional `reloadTemplates` flag (default `true`). Although autosave now bypasses the service, UI-driven operations (Save, Save As, Import, Delete) can set `reloadTemplates: false` when they only need to update an existing template without rescanning `.hifide-public/flows`. The default remains `true` so template pickers refresh automatically after structural changes such as renames or new template creation.

## Related files
- `src/store/flowEditorLocal.ts`
- `electron/backend/ws/handlers/flow-editor-handlers.ts`
- `electron/services/FlowProfileService.ts`
- `electron/services/flowProfiles.ts`
- `electron/services/flowAutosave.ts`
- `electron/services/__tests__/flowAutosave.test.ts`
- `electron/services/__tests__/FlowProfileService.test.ts`
