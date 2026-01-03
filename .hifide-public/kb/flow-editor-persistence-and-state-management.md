---
id: 406ebd00-c2df-4739-9daf-ac65649f172e
title: Flow Editor Persistence and State Management
tags: [flow-editor, persistence, state-management, zustand, rpc]
files: [src/store/flowEditor.ts, src/store/flowEditorLocal.ts, electron/backend/ws/handlers/flow-editor-handlers.ts, electron/services/FlowGraphService.ts]
createdAt: 2026-01-03T06:04:31.712Z
updatedAt: 2026-01-03T06:10:58.388Z
---

---
id: 406ebd00-c2df-4739-9daf-ac65649f172e
title: Flow Editor Persistence and State Management
tags: [flow-editor, persistence, state-management, zustand, rpc]
files: [src/store/flowEditor.ts, src/store/flowEditorLocal.ts, electron/backend/ws/handlers/flow-editor-handlers.ts, electron/services/FlowGraphService.ts]
---

# Flow Editor Persistence and State Management

## Overview
The Flow Editor uses a two-tier state management system to ensure high performance and reliable persistence.

### 1. Frontend State (`FlowEditorStore` & `FlowEditorLocalStore`)
- **FlowEditorStore (`src/store/flowEditor.ts`)**: Manages the "committed" state, available templates, and profile-level actions (load, save as, delete). It communicates with the backend via RPC.
- **FlowEditorLocalStore (`src/store/flowEditorLocal.ts`)**: Manages the "live" editing state. It handles local node/edge changes and coordinates the debounced auto-save mechanism.

### 2. Backend State (`FlowGraphService`)
- Stores the last-saved graph for a workspace.
- Track which template is currently "selected" (loaded) in the editor.
- Emits events when the graph changes, which the frontend subscribes to for synchronization.

## Persistence Lifecycle

### Auto-save
The `FlowEditorLocalStore` monitors local changes and computes a "signature" of the graph. When the local signature differs from the `lastSavedSignature`, the graph is considered "dirty". A debounced timer (default 500ms) then sends the graph to the backend via `flowEditor.setGraph`.

### Manual Save (Save As)
When a user performs a "Save As", the frontend:
1. Cancels any pending auto-save via `cancelSave()`.
2. Sends the current graph to the backend.
3. Creates a new profile file on disk.
4. Sets the new profile as the "selected" template.
5. Updates the local "dirty" state to "Saved".

### Deletion and Selection Switching
When a profile is deleted:
1. The frontend cancels any pending auto-save to prevent re-creating the file during deletion.
2. The backend clears the `selectedTemplateId` in `FlowGraphService` **before** deleting the file. This ensures that any in-flight `setGraph` RPCs do not try to re-save to the profile being deleted.
3. The backend deletes the file.
4. The frontend `deleteProfile` action detects if the active profile was deleted.
5. It automatically calculates a successor based on the same library (next relative index) or falls back to a system template.
6. It triggers a `loadTemplate` for the successor.

## Deletion Race Condition Protection
To prevent the auto-save mechanism from re-creating a profile file immediately after it has been deleted, a two-layered protection is implemented:
- **Frontend**: All destructive or state-switching actions (`deleteProfile`, `loadTemplate`, `createNewFlowNamed`) call `cancelSave()` on the `FlowEditorLocalStore` to clear pending debounced timers.
- **Backend**: `flowEditor.deleteProfile` proactively clears the selection in the `FlowGraphService`. Since the auto-save logic in the backend only persists files if a template is selected, this blocks any late-arriving auto-save RPCs from re-creating the file.

## Status Indicators
The `FlowCanvasPanel` displays a status badge:
- **Saving...** (Blue): Active RPC call in progress.
- **Unsaved** (Yellow): Local changes exist but are not yet sent to the backend.
- **Saved** (Green): Local state matches the backend.
