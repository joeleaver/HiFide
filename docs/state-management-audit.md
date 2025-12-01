# State Management Audit - Frontend/Backend Separation

**Date**: 2025-11-28  
**Status**: Analysis Complete

## Executive Summary

We have a **crossover problem** where UI state is duplicated between frontend and backend, violating the principle that:
- **Backend** should manage pure data and persistence
- **Frontend** should manage UI state

Currently, the backend `UiService` is managing UI-specific state (panel widths, collapsed states) that should be frontend-only.

---

## Current Architecture

### Backend (Main Process)

**UiService** (`electron/services/UiService.ts`)
- Manages `WindowState` object with UI panel preferences
- Persists to electron-store (global app data)
- Provides RPCs: `ui.getWindowState`, `ui.updateWindowState`, `ui.toggleWindowState`

**WindowState Fields** (22 fields):
```typescript
{
  agentMode: 'chat' | 'flow'
  flowCanvasCollapsed: boolean
  flowCanvasWidth: number
  metaPanelOpen: boolean
  metaPanelWidth: number
  sidebarCollapsed: boolean
  debugPanelCollapsed: boolean
  debugPanelHeight: number
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number
  sessionPanelWidth: number
  sessionPanelHeight: number
  rightPaneCollapsed: boolean
  agentTerminalPanelOpen: boolean
  agentTerminalPanelHeight: number
  explorerTerminalPanelOpen: boolean
  explorerTerminalPanelHeight: number
}
```

**ViewService** (`electron/services/ViewService.ts`)
- Manages `currentView` (welcome | flow | explorer | etc.)
- Persists to electron-store
- Provides RPCs: `view.get`, `view.set`

### Frontend (Renderer Process)

**useUiStore** (`src/store/ui.ts`)
- Manages same UI state as backend WindowState
- **Plus** additional renderer-only state:
  - `isDraggingSessionPanel`, `isDraggingMetaPanel` (transient drag state)
  - `shouldAutoScroll` (scroll behavior)
  - `sessionInputValue` (input field value)
  - `diffPreviewOpen`, `diffPreviewData` (modal state)
  - `inlineDiffByBadge`, `inlineDiffOpenByBadge` (badge diff state)
  - `expandedBadges` (badge expansion state)
  - `newFlowModalOpen`, `newFlowName`, `newFlowError` (modal state)

**Current Sync Pattern** (PROBLEMATIC):
1. Component mounts
2. Calls `ui.getWindowState` RPC to hydrate from backend
3. User interacts (resize, collapse, etc.)
4. Updates local store immediately
5. Calls `ui.updateWindowState` RPC to persist to backend

**Examples**:
- `ContextInspectorPanel.tsx` lines 32-36, 48, 53
- `TokensCostsPanel.tsx` lines 28-38, 57, 63
- `AgentDebugPanel.tsx` lines 25-35, 122, 127
- `FlowView.tsx` lines 79-83

---

## Problems with Current Architecture

### 1. **Duplication of State**
- Same UI state exists in both backend (UiService) and frontend (useUiStore)
- Two sources of truth that must be kept in sync
- Hydration complexity on every component mount

### 2. **Unnecessary RPC Chatter**
- Every panel collapse/expand triggers an RPC call
- Every panel resize triggers an RPC call
- High-frequency UI interactions hitting IPC layer

### 3. **Persistence Location Confusion**
- Backend persists to global electron-store (app data directory)
- Some components also persist to workspace-specific settings (e.g., `GlobalSessionPanel.tsx` line 32-40)
- Unclear which persistence layer is authoritative

### 4. **Backend Managing UI Concerns**
- Backend shouldn't care about panel widths, collapsed states
- These are purely presentation concerns
- Backend should only manage domain data (sessions, flows, kanban, etc.)

### 5. **View State Split**
- `currentView` managed by backend ViewService
- But it's purely a UI routing concern
- Should be frontend-only

---

## Recommended Architecture

### Backend Responsibilities (Pure Data)
- **Sessions**: session list, current session, timeline, usage, costs
- **Flows**: flow profiles, templates, graph state, execution state
- **Kanban**: board data, tasks, epics
- **Knowledge Base**: entries, tags, search index
- **Workspace**: root path, recent folders, file watching
- **Settings**: API keys, provider config, pricing config
- **Terminal**: PTY sessions, terminal data
- **Explorer**: file tree state, opened file

### Frontend Responsibilities (UI State)
- **Panel Sizes**: all widths and heights
- **Panel Collapsed States**: all collapsed/expanded flags
- **Current View**: which screen is active (welcome, flow, explorer, etc.)
- **Drag States**: isDragging flags
- **Scroll States**: auto-scroll, user-scrolled-up flags
- **Modal States**: open/closed, form values, errors
- **Badge States**: expanded/collapsed, inline diffs
- **Input Values**: session input, search inputs, etc.

### Persistence Strategy
1. **Global UI Preferences** → localStorage (renderer-only)
   - Panel sizes, collapsed states, view preference
   - Survives app restart, per-user
   
2. **Workspace-Specific Layout** → `.hifide-private/settings.json` (via backend RPC)
   - Only if we want per-project layouts
   - Example: session panel width for this specific project
   
3. **Domain Data** → electron-store (backend)
   - Sessions, flows, kanban, settings, etc.

---

## Migration Plan

### Phase 1: Move UI State to Frontend-Only ✅ RECOMMENDED

**Changes**:
1. Remove `UiService` from backend entirely
2. Remove `ViewService` from backend entirely
3. Move all UI state to `useUiStore` (frontend)
4. Persist UI state to localStorage (renderer)
5. Remove all `ui.*` and `view.*` RPC handlers
6. Update components to remove RPC calls for UI state

**Benefits**:
- Eliminates duplication
- Reduces RPC chatter
- Clearer separation of concerns
- Simpler hydration (no backend sync needed)

**Risks**:
- Lose global persistence (electron-store)
- Each window would have independent UI state
- But this is probably fine - UI state is window-specific anyway

### Phase 2: Workspace-Specific Layout (Optional)

If we want per-project layouts:
1. Add `workspace.getLayout` / `workspace.setLayout` RPCs
2. Store layout in `.hifide-private/settings.json`
3. Frontend hydrates from workspace layout on workspace load
4. Frontend persists debounced to workspace layout

**Fields for workspace layout**:
- `sessionPanelWidth`
- `mainCollapsed`
- Maybe `metaPanelWidth`, `metaPanelOpen`

---

## Detailed State Field Analysis

### Fields Currently in BOTH Backend and Frontend

| Field | Backend (UiService) | Frontend (useUiStore) | Used By | Recommendation |
|-------|---------------------|----------------------|---------|----------------|
| `sessionPanelWidth` | ✅ | ✅ | GlobalSessionPanel | Frontend-only, persist to workspace settings |
| `metaPanelWidth` | ✅ | ✅ | FlowView | Frontend-only, localStorage |
| `metaPanelOpen` | ✅ | ✅ | FlowView | Frontend-only, localStorage |
| `debugPanelCollapsed` | ✅ | ✅ | AgentDebugPanel | Frontend-only, localStorage |
| `debugPanelHeight` | ✅ | ✅ | AgentDebugPanel | Frontend-only, localStorage |
| `contextInspectorCollapsed` | ✅ | ✅ | ContextInspectorPanel | Frontend-only, localStorage |
| `contextInspectorHeight` | ✅ | ✅ | ContextInspectorPanel | Frontend-only, localStorage |
| `tokensCostsCollapsed` | ✅ | ✅ | TokensCostsPanel | Frontend-only, localStorage |
| `tokensCostsHeight` | ✅ | ✅ | TokensCostsPanel | Frontend-only, localStorage |
| `rightPaneCollapsed` | ✅ | ✅ | App.tsx | Frontend-only, localStorage |
| `mainCollapsed` | ❌ | ✅ | GlobalSessionPanel | Frontend-only, persist to workspace settings |

### Fields ONLY in Backend (UiService)

| Field | Used By | Recommendation |
|-------|---------|----------------|
| `agentMode` | ❌ Not used | Remove entirely |
| `flowCanvasCollapsed` | ❌ Not used | Remove entirely |
| `flowCanvasWidth` | ❌ Not used | Remove entirely |
| `sidebarCollapsed` | ❌ Not used | Remove entirely |
| `sessionPanelHeight` | ❌ Not used | Remove entirely |
| `agentTerminalPanelOpen` | ❌ Not used | Remove entirely |
| `agentTerminalPanelHeight` | ❌ Not used | Remove entirely |
| `explorerTerminalPanelOpen` | ❌ Not used | Remove entirely |
| `explorerTerminalPanelHeight` | ❌ Not used | Remove entirely |

### Fields ONLY in Frontend (useUiStore)

| Field | Purpose | Recommendation |
|-------|---------|----------------|
| `isDraggingSessionPanel` | Transient drag state | ✅ Correct - renderer-only |
| `isDraggingMetaPanel` | Transient drag state | ✅ Correct - renderer-only |
| `shouldAutoScroll` | Scroll behavior | ✅ Correct - renderer-only |
| `sessionInputValue` | Input field value | ✅ Correct - renderer-only |
| `debugPanelUserScrolledUp` | Scroll state | ✅ Correct - renderer-only |
| `diffPreviewOpen` | Modal state | ✅ Correct - renderer-only |
| `diffPreviewData` | Modal data | ✅ Correct - renderer-only |
| `inlineDiffByBadge` | Badge diff data | ✅ Correct - renderer-only |
| `inlineDiffOpenByBadge` | Badge diff state | ✅ Correct - renderer-only |
| `expandedBadges` | Badge expansion | ✅ Correct - renderer-only |
| `newFlowModalOpen` | Modal state | ✅ Correct - renderer-only |
| `newFlowName` | Modal form value | ✅ Correct - renderer-only |
| `newFlowError` | Modal error | ✅ Correct - renderer-only |
| `currentView` | Active screen | ⚠️ Should be frontend-only (currently also in ViewService) |

---

## Other Frontend Stores (Already Correct)

### ✅ `useFlowEditorLocal` - Renderer-only graph editing state
- `nodes`, `edges`, `selection`, `layout`
- Debounced sync to backend via RPC
- **Correct pattern**: Frontend manages live editing, backend persists

### ✅ `useChatTimeline` - Renderer-only timeline rendering
- `items`, `sig`, `isHydrating`, `hasRenderedOnce`
- Hydrated from backend session data
- **Correct pattern**: Backend owns data, frontend manages rendering state

### ✅ `useFlowRuntime` - Renderer-only flow execution UI
- `status`, `nodeStates`, `currentRequestId`
- Hydrated from backend flow events
- **Correct pattern**: Backend owns execution, frontend manages UI state

### ⚠️ `useSessionUi` - Mixed responsibilities
- **Backend data** (correct): `sessions`, `currentId`, `executedFlowId`, `providerId`, `modelId`, `tokenUsage`, `costs`, `requestsLog`, `flows`, `providerValid`, `modelsByProvider`
- **Hydration flags** (correct): `isHydratingMeta`, `isHydratingUsage`, `hasHydratedList`, `eventsInited`
- **Recommendation**: This is fine - it's a frontend cache of backend data

### ⚠️ `useFlowEditor` - Mixed responsibilities
- **Backend data** (correct): `availableTemplates`, `selectedTemplate`, `currentGraph`
- **Hydration flags** (correct): `templatesLoaded`, `graphVersion`, `isHydratingGraph`
- **Recommendation**: This is fine - it's a frontend cache of backend data

### ⚠️ `useKanban` - Mixed responsibilities
- **Backend data** (correct): `board`
- **Loading flags** (correct): `loading`, `saving`, `error`
- **Recommendation**: This is fine - it's a frontend cache of backend data

### ⚠️ `useKnowledgeBase` - Mixed responsibilities
- **Backend data** (correct): `itemsMap`, `workspaceFiles`
- **Loading flags** (correct): `loading`
- **Recommendation**: This is fine - it's a frontend cache of backend data

---

## Next Steps

1. **Decision**: Do we want global UI persistence or per-window UI state?
   - **Recommendation**: Per-window (localStorage) for most UI state
   - **Exception**: Workspace-specific layout (session panel width, main collapsed) → workspace settings

2. **Decision**: Do we want per-workspace layouts?
   - **Recommendation**: Yes, for `sessionPanelWidth` and `mainCollapsed` only
   - Already partially implemented in `GlobalSessionPanel.tsx`

3. **Implementation**: Execute Phase 1 migration
   - Remove `UiService` from backend
   - Remove `ViewService` from backend
   - Move all UI state to frontend localStorage
   - Keep workspace layout in `.hifide-private/settings.json`

4. **Testing**: Verify UI state persists correctly across app restarts

5. **Cleanup**: Remove dead code (UiService, ViewService, RPC handlers, unused WindowState fields)

---

## Components Requiring Updates

### Components with RPC Calls to Remove

1. **ContextInspectorPanel.tsx** (lines 32-36, 48, 53)
   - Remove `ui.getWindowState` RPC call
   - Remove `ui.updateWindowState` RPC calls
   - Use localStorage persistence instead

2. **TokensCostsPanel.tsx** (lines 28-38, 57, 63)
   - Remove `ui.getWindowState` RPC call
   - Remove `ui.updateWindowState` RPC calls
   - Use localStorage persistence instead

3. **AgentDebugPanel.tsx** (lines 25-35, 122, 127)
   - Remove `ui.getWindowState` RPC call
   - Remove `ui.updateWindowState` RPC calls
   - Use localStorage persistence instead

4. **FlowView.tsx** (lines 79-83)
   - Remove `ui.getWindowState` RPC call
   - Use localStorage persistence instead

5. **GlobalSessionPanel.tsx** (lines 32-40)
   - Already persists to workspace settings (correct!)
   - Remove any `ui.*` RPC calls if present
   - Keep workspace settings persistence

6. **App.tsx** (lines 115-126)
   - Already loads from workspace settings (correct!)
   - Remove any `ui.*` RPC calls if present
   - Keep workspace settings loading

### Components Using View State

1. **ActivityBar.tsx** - Uses `currentView` to highlight active nav item
   - Change from backend ViewService to frontend useUiStore
   - Persist to localStorage

2. **App.tsx** - Routes based on `currentView`
   - Change from backend ViewService to frontend useUiStore
   - Persist to localStorage

### Backend Files to Remove

1. **electron/services/UiService.ts** - Entire file
2. **electron/services/ViewService.ts** - Entire file
3. **electron/backend/ws/handlers/ui-handlers.ts** - Remove `ui.*` methods (keep `window.*`, `explorer.*`, `editor.*`)
4. **electron/store/utils/constants.ts** - Remove if unused (already flagged for cleanup)

### Backend Files to Update

1. **electron/backend/ws/handlers/ui-handlers.ts**
   - Remove: `ui.getWindowState`, `ui.updateWindowState`, `ui.toggleWindowState`
   - Remove: `view.get`, `view.set`
   - Keep: `window.*`, `explorer.*`, `editor.*` methods

2. **electron/services/index.ts**
   - Remove UiService initialization
   - Remove ViewService initialization
   - Remove from registry

3. **electron/backend/ws/snapshot.ts**
   - Remove any UI state from workspace snapshot (if present)

### Frontend Files to Update

1. **src/store/ui.ts**
   - Add localStorage persistence for all UI state
   - Remove comments about "syncing from main store"
   - Add `currentView` field (move from ViewService)

2. **src/store/utils/persistence.ts** (create if needed)
   - Helper functions for localStorage persistence
   - Debounced save for high-frequency updates (panel resize)

3. **src/store/workspaceUi.ts**
   - Remove `view.set` RPC calls
   - Use local `useUiStore.setCurrentViewLocal` instead

---

## Implementation Checklist

### Phase 1: Frontend Changes

- [ ] Add localStorage persistence to `useUiStore`
- [ ] Add `currentView` to `useUiStore` (move from ViewService)
- [ ] Update `ContextInspectorPanel.tsx` to use localStorage
- [ ] Update `TokensCostsPanel.tsx` to use localStorage
- [ ] Update `AgentDebugPanel.tsx` to use localStorage
- [ ] Update `FlowView.tsx` to use localStorage
- [ ] Update `ActivityBar.tsx` to use `useUiStore.currentView`
- [ ] Update `App.tsx` to use `useUiStore.currentView`
- [ ] Update `workspaceUi.ts` to use `useUiStore.setCurrentViewLocal`
- [ ] Test: UI state persists across app restarts
- [ ] Test: Each window has independent UI state

### Phase 2: Backend Cleanup

- [ ] Remove `UiService` from `electron/services/`
- [ ] Remove `ViewService` from `electron/services/`
- [ ] Remove `ui.*` and `view.*` RPC handlers
- [ ] Remove UiService/ViewService from service registry
- [ ] Remove UiService/ViewService from service initialization
- [ ] Test: App still works without backend UI services
- [ ] Test: No RPC errors in console

### Phase 3: Documentation

- [ ] Update architecture docs to reflect new pattern
- [ ] Update service patterns doc
- [ ] Add localStorage persistence pattern to docs
- [ ] Remove references to UiService/ViewService

---

## Open Questions

1. **Multi-window support**: If we support multiple windows in the future, should each window have independent UI state or shared?
   - **Current recommendation**: Independent per-window (localStorage is window-scoped)
   - **Alternative**: Shared via backend (but this brings back the crossover problem)

2. **Workspace-specific layouts**: Which fields should be workspace-specific vs. global?
   - **Current recommendation**: Only `sessionPanelWidth` and `mainCollapsed`
   - **Rationale**: These affect the overall layout and might vary by project size

3. **Migration of existing user preferences**: How do we migrate existing UiService data to localStorage?
   - **Option 1**: One-time migration on app startup (read from electron-store, write to localStorage, delete from electron-store)
   - **Option 2**: Let users reset their preferences (simpler, acceptable for beta)
   - **Recommendation**: Option 1 for better UX

4. **Persistence timing**: Should we debounce localStorage writes for high-frequency updates?
   - **Recommendation**: Yes, debounce panel resize updates (500ms)
   - **Rationale**: Avoid excessive writes during drag operations


