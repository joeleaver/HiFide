---
id: 1555924f-0c3b-47dc-a622-927ec332b749
title: Flow editor autosave workspace scoping
tags: [flows, autosave, workspace-scope]
files: [src/store/flowEditorLocal.ts, electron/backend/ws/handlers/flow-editor-handlers.ts, electron/services/FlowProfileService.ts, electron/services/flowProfiles.ts]
createdAt: 2025-12-11T01:16:28.152Z
updatedAt: 2025-12-11T01:16:28.152Z
---

## Overview
Flow edits are managed locally inside `useFlowEditorLocal`. The renderer stores a real-time graph, subscribes to node/edge mutations, and debounces RPC calls to `flowEditor.setGraph`. The backend handler (`electron/backend/ws/handlers/flow-editor-handlers.ts`) records the graph inside `FlowGraphService` and, for user/workspace flows, calls `FlowProfileService.saveProfile` to persist `.hifide-public/flows/<template>.json`.

## Required workspace context
Every renderer connection is bound to a workspace, so RPC handlers always call `getConnectionWorkspaceId` before reading or writing flow state. `FlowGraphService` and the autosave handler both scope to that ID, but `FlowProfileService` previously called `saveWorkspaceFlowProfile` / `deleteWorkspaceFlowProfile` without passing the workspace ID. These helpers defaulted to `process.cwd()` via `resolveWorkspaceRootAsync()`, so autosaves silently targeted the application root instead of the active project.

## Impact
When two projects are open, user edits in one window can overwrite `.hifide-public/flows` under the other project (or never appear in the intended workspace). This presents as "autosave not working" because reloading the workspace rehydrates from `.hifide-public/flows` in the wrong directory.

## Fix strategy
* Thread the current `workspaceId` through every path that loads or saves workspace flow profiles:
  * Extend `saveWorkspaceFlowProfile` / `deleteWorkspaceFlowProfile` to accept a workspace hint and resolve the correct `.hifide-public/flows` directory.
  * Pass the workspace ID from `FlowProfileService.saveProfile`, `.deleteProfile`, and `.loadTemplate`.
  * Ensure all backend RPC sites (`snapshot`, `session.setExecutedFlow`, `flow.start`, `flowEditor.loadTemplate`, etc.) forward their `workspaceId` into `FlowProfileService`.
* After changes, autosave persists to the workspace-specific flows directory, matching how kanban/knowledge-base data is scoped.
