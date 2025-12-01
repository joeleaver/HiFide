# State Management Crossover - Visual Summary

## The Problem

```
┌─────────────────────────────────────────────────────────────────┐
│                         CURRENT STATE                            │
│                                                                  │
│  ┌──────────────────────┐         ┌──────────────────────┐     │
│  │   BACKEND (Main)     │         │  FRONTEND (Renderer) │     │
│  │                      │         │                      │     │
│  │  UiService           │◄───────►│  useUiStore          │     │
│  │  ├─ sessionPanelWidth│  RPC    │  ├─ sessionPanelWidth│     │
│  │  ├─ metaPanelWidth   │  sync   │  ├─ metaPanelWidth   │     │
│  │  ├─ debugPanelHeight │         │  ├─ debugPanelHeight │     │
│  │  ├─ ...collapsed     │         │  ├─ ...collapsed     │     │
│  │  └─ (22 fields)      │         │  └─ (22+ fields)     │     │
│  │                      │         │                      │     │
│  │  ViewService         │         │  currentView (local) │     │
│  │  └─ currentView      │◄───────►│                      │     │
│  │                      │         │                      │     │
│  │  Persists to:        │         │  Persists to:        │     │
│  │  electron-store      │         │  (nothing - relies   │     │
│  │  (global app data)   │         │   on backend sync)   │     │
│  └──────────────────────┘         └──────────────────────┘     │
│                                                                  │
│  PROBLEM: Duplication, RPC chatter, unclear ownership           │
└─────────────────────────────────────────────────────────────────┘
```

## The Solution

```
┌─────────────────────────────────────────────────────────────────┐
│                        PROPOSED STATE                            │
│                                                                  │
│  ┌──────────────────────┐         ┌──────────────────────┐     │
│  │   BACKEND (Main)     │         │  FRONTEND (Renderer) │     │
│  │                      │         │                      │     │
│  │  SessionService      │────────►│  useSessionUi        │     │
│  │  FlowGraphService    │  events │  useChatTimeline     │     │
│  │  KanbanService       │  only   │  useFlowEditor       │     │
│  │  WorkspaceService    │         │  useKanban           │     │
│  │  SettingsService     │         │                      │     │
│  │  ...                 │         │  useUiStore          │     │
│  │                      │         │  ├─ sessionPanelWidth│     │
│  │  ❌ UiService        │         │  ├─ metaPanelWidth   │     │
│  │  ❌ ViewService      │         │  ├─ debugPanelHeight │     │
│  │                      │         │  ├─ currentView      │     │
│  │                      │         │  ├─ ...collapsed     │     │
│  │                      │         │  └─ (all UI state)   │     │
│  │                      │         │                      │     │
│  │  Persists to:        │         │  Persists to:        │     │
│  │  electron-store      │         │  localStorage        │     │
│  │  (domain data only)  │         │  (UI state only)     │     │
│  └──────────────────────┘         └──────────────────────┘     │
│                                                                  │
│  BENEFIT: Clear separation, no duplication, no RPC chatter      │
└─────────────────────────────────────────────────────────────────┘
```

## Current Data Flow (PROBLEMATIC)

```
User resizes panel
       │
       ▼
Component updates local state (useUiStore)
       │
       ▼
Component calls ui.updateWindowState RPC ──────► Backend UiService
       │                                              │
       │                                              ▼
       │                                         Persists to
       │                                         electron-store
       │
       ▼
On next mount:
Component calls ui.getWindowState RPC ◄────────── Backend UiService
       │                                              │
       ▼                                              │
Hydrates local state from backend                    │
                                                      │
PROBLEM: Round-trip for every UI interaction ────────┘
```

## Proposed Data Flow (CLEAN)

```
User resizes panel
       │
       ▼
Component updates local state (useUiStore)
       │
       ▼
Debounced persist to localStorage
       │
       ▼
Done! ✅

On next mount:
Component reads from localStorage
       │
       ▼
Hydrates local state
       │
       ▼
Done! ✅

BENEFIT: No backend involvement, instant, simple
```

## State Categories

### ✅ Backend-Owned (Domain Data)
- Sessions, flows, kanban, knowledge base
- Workspace root, recent folders
- API keys, provider config
- Terminal PTY sessions
- File tree state

### ✅ Frontend-Owned (UI State)
- Panel widths, heights
- Collapsed/expanded states
- Current view (routing)
- Drag states, scroll states
- Modal states, form values
- Badge expansion states

### ⚠️ Hybrid (Workspace-Specific Layout)
- Session panel width (per-project)
- Main collapsed state (per-project)
- Stored in `.hifide-private/settings.json`
- Backend provides RPC, frontend manages

## Migration Impact

### Files to Remove
- `electron/services/UiService.ts` (178 lines)
- `electron/services/ViewService.ts` (67 lines)
- RPC handlers for `ui.*` and `view.*` methods

### Files to Update
- `src/store/ui.ts` - Add localStorage persistence
- `src/components/ContextInspectorPanel.tsx` - Remove RPC calls
- `src/components/TokensCostsPanel.tsx` - Remove RPC calls
- `src/components/AgentDebugPanel.tsx` - Remove RPC calls
- `src/components/FlowView.tsx` - Remove RPC calls
- `src/components/ActivityBar.tsx` - Use local currentView
- `src/components/App.tsx` - Use local currentView

### Estimated Effort
- **Phase 1** (Frontend changes): 2-3 hours
- **Phase 2** (Backend cleanup): 1 hour
- **Phase 3** (Testing): 1 hour
- **Total**: 4-5 hours

### Risk Level
- **Low**: UI state is isolated, no domain logic affected
- **Testing**: Verify UI state persists across restarts
- **Rollback**: Easy - keep old code until verified

