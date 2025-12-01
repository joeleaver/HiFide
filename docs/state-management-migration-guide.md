# State Management Migration Guide

## Goal
Move all UI state from backend (UiService, ViewService) to frontend-only (useUiStore with workspace-scoped localStorage).

## Status
✅ **MIGRATION COMPLETE!**

All phases completed:
1. ✅ Vite dev server port pinned to 5179
2. ✅ Workspace-scoped localStorage persistence implemented
3. ✅ All components updated to remove RPC calls
4. ✅ Backend services (UiService, ViewService) removed
5. ✅ RPC handlers cleaned up

## Summary of Changes

### Frontend Changes
- **vite.config.ts**: Pinned dev server to port 5179 with strictPort
- **src/store/utils/uiPersistence.ts**: New workspace-scoped localStorage helper
- **src/store/ui.ts**: Updated to load/save from localStorage, added currentView field
- **src/lib/backend/bootstrap.ts**: Reloads UI state on workspace.attached event
- **Components updated**: ContextInspectorPanel, TokensCostsPanel, AgentDebugPanel, FlowView, ActivityBar, App.tsx

### Backend Changes
- **electron/services/UiService.ts**: DELETED
- **electron/services/ViewService.ts**: DELETED
- **electron/services/index.ts**: Removed UiService and ViewService initialization and exports
- **electron/services/AppService.ts**: Removed getViewService import and viewService.setView() call
- **electron/backend/ws/handlers/ui-handlers.ts**: Removed view.get, view.set, ui.getWindowState, ui.updateWindowState, ui.toggleWindowState RPC methods
- **electron/services/__tests__/phase1-services.test.ts**: Removed ViewService and UiService tests

---

## Step 1: Add localStorage Persistence to useUiStore

### Create persistence helper

**File**: `src/store/utils/uiPersistence.ts` (new file)

```typescript
const UI_STORAGE_KEY = 'hifide:ui-state'

export interface PersistedUiState {
  sessionPanelWidth: number
  metaPanelWidth: number
  metaPanelOpen: boolean
  debugPanelCollapsed: boolean
  debugPanelHeight: number
  contextInspectorCollapsed: boolean
  contextInspectorHeight: number
  tokensCostsCollapsed: boolean
  tokensCostsHeight: number
  rightPaneCollapsed: boolean
  currentView: string
}

export function loadUiState(): Partial<PersistedUiState> {
  try {
    const stored = localStorage.getItem(UI_STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function saveUiState(state: Partial<PersistedUiState>): void {
  try {
    const existing = loadUiState()
    const merged = { ...existing, ...state }
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(merged))
  } catch (e) {
    console.warn('[uiPersistence] Failed to save:', e)
  }
}

// Debounced save for high-frequency updates (panel resize)
let saveTimeout: any = null
export function saveUiStateDebounced(state: Partial<PersistedUiState>, delayMs = 500): void {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => saveUiState(state), delayMs)
}
```

### Update useUiStore

**File**: `src/store/ui.ts`

```typescript
import { loadUiState, saveUiState, saveUiStateDebounced } from './utils/uiPersistence'

// Initialize from localStorage
const persisted = loadUiState()

export const useUiStore = create<UiStore>((set) => ({
  // Initialize with persisted values or defaults
  sessionPanelWidth: persisted.sessionPanelWidth ?? 300,
  metaPanelWidth: persisted.metaPanelWidth ?? 300,
  metaPanelOpen: persisted.metaPanelOpen ?? false,
  debugPanelCollapsed: persisted.debugPanelCollapsed ?? false,
  debugPanelHeight: persisted.debugPanelHeight ?? 300,
  contextInspectorCollapsed: persisted.contextInspectorCollapsed ?? false,
  contextInspectorHeight: persisted.contextInspectorHeight ?? 200,
  tokensCostsCollapsed: persisted.tokensCostsCollapsed ?? false,
  tokensCostsHeight: persisted.tokensCostsHeight ?? 250,
  rightPaneCollapsed: persisted.rightPaneCollapsed ?? false,
  currentView: (persisted.currentView as ViewType) ?? 'welcome',
  
  // Transient state (not persisted)
  isDraggingSessionPanel: false,
  isDraggingMetaPanel: false,
  shouldAutoScroll: true,
  sessionInputValue: '',
  // ... other transient state
  
  // Actions with persistence
  setSessionPanelWidth: (width) => {
    set({ sessionPanelWidth: width })
    saveUiStateDebounced({ sessionPanelWidth: width })
  },
  
  setMetaPanelWidth: (width) => {
    set({ metaPanelWidth: width })
    saveUiStateDebounced({ metaPanelWidth: width })
  },
  
  setMetaPanelOpen: (open) => {
    set({ metaPanelOpen: open })
    saveUiState({ metaPanelOpen: open })
  },
  
  setDebugPanelCollapsed: (collapsed) => {
    set({ debugPanelCollapsed: collapsed })
    saveUiState({ debugPanelCollapsed: collapsed })
  },
  
  setDebugPanelHeight: (height) => {
    set({ debugPanelHeight: height })
    saveUiStateDebounced({ debugPanelHeight: height })
  },
  
  setContextInspectorCollapsed: (collapsed) => {
    set({ contextInspectorCollapsed: collapsed })
    saveUiState({ contextInspectorCollapsed: collapsed })
  },
  
  setContextInspectorHeight: (height) => {
    set({ contextInspectorHeight: height })
    saveUiStateDebounced({ contextInspectorHeight: height })
  },
  
  setTokensCostsCollapsed: (collapsed) => {
    set({ tokensCostsCollapsed: collapsed })
    saveUiState({ tokensCostsCollapsed: collapsed })
  },
  
  setTokensCostsHeight: (height) => {
    set({ tokensCostsHeight: height })
    saveUiStateDebounced({ tokensCostsHeight: height })
  },
  
  setRightPaneCollapsed: (collapsed) => {
    set({ rightPaneCollapsed: collapsed })
    saveUiState({ rightPaneCollapsed: collapsed })
  },
  
  setCurrentViewLocal: (view) => {
    set({ currentView: view })
    saveUiState({ currentView: view })
  },
  
  // Transient actions (no persistence)
  setIsDraggingSessionPanel: (dragging) => set({ isDraggingSessionPanel: dragging }),
  setIsDraggingMetaPanel: (dragging) => set({ isDraggingMetaPanel: dragging }),
  setShouldAutoScroll: (should) => set({ shouldAutoScroll: should }),
  setSessionInputValue: (value) => set({ sessionInputValue: value }),
  // ... other transient actions
}))
```

---

## Step 2: Update Components to Remove RPC Calls

### ContextInspectorPanel.tsx

**Before**:
```typescript
useEffect(() => {
  const client = getBackendClient(); if (!client) return
  client.rpc('ui.getWindowState', {}).then((res: any) => {
    const ws = (res && res.windowState) || {}
    setCollapsed(ws.contextInspectorCollapsed ?? false)
    setHeight(ws.contextInspectorHeight ?? 240)
  }).catch(() => {})
}, [])

// ...

onToggleCollapse={() => {
  const newCollapsed = !collapsed
  setCollapsed(newCollapsed)
  const client = getBackendClient(); if (client) client.rpc('ui.updateWindowState', { updates: { contextInspectorCollapsed: newCollapsed } }).catch(() => {})
}}
```

**After**:
```typescript
// Remove useEffect entirely - state is already initialized from localStorage

// ...

onToggleCollapse={() => {
  setCollapsed(!collapsed) // This now persists automatically via store action
}}
```

### Apply same pattern to:
- `TokensCostsPanel.tsx`
- `AgentDebugPanel.tsx`
- `FlowView.tsx`

---

## Step 3: Update View Management

### ActivityBar.tsx

**Before**:
```typescript
// Calls backend view.set RPC
```

**After**:
```typescript
import { useUiStore } from '../store/ui'

const currentView = useUiStore((s) => s.currentView)
const setCurrentView = useUiStore((s) => s.setCurrentViewLocal)

// Use setCurrentView directly, no RPC
```

### App.tsx

Same pattern - use `useUiStore.currentView` instead of backend ViewService.

---

## Step 4: Remove Backend Services

### Delete files:
- `electron/services/UiService.ts`
- `electron/services/ViewService.ts`

### Update `electron/services/index.ts`:
```typescript
// Remove these lines:
import { UiService } from './UiService'
import { ViewService } from './ViewService'

let uiService: UiService
let viewService: ViewService

// In initializeServices():
// Remove: uiService = new UiService()
// Remove: viewService = new ViewService()
// Remove: registry.register('ui', uiService)
// Remove: registry.register('view', viewService)

// Remove from exports:
// export { UiService } from './UiService'
// export { ViewService } from './ViewService'
```

### Update `electron/backend/ws/handlers/ui-handlers.ts`:
```typescript
// Remove these methods:
// - ui.getWindowState
// - ui.updateWindowState
// - ui.toggleWindowState
// - view.get
// - view.set

// Keep these methods (they're not UI state):
// - window.* (window controls)
// - explorer.* (file tree state)
// - editor.* (opened file)
```

---

## Step 5: Migration of Existing User Data (Optional)

Add one-time migration in `src/store/ui.ts`:

```typescript
// One-time migration from backend UiService to localStorage
async function migrateFromBackend() {
  const migrated = localStorage.getItem('hifide:ui-migrated')
  if (migrated) return // Already migrated
  
  try {
    const client = getBackendClient()
    const res: any = await client?.rpc('ui.getWindowState', {})
    if (res?.windowState) {
      saveUiState(res.windowState)
      localStorage.setItem('hifide:ui-migrated', 'true')
    }
  } catch {
    // Migration failed, use defaults
    localStorage.setItem('hifide:ui-migrated', 'true')
  }
}

// Call on app startup (in bootstrap or App.tsx)
migrateFromBackend()
```

---

## Testing Checklist

- [ ] UI state persists across app restarts
- [ ] Panel resize works and persists
- [ ] Panel collapse/expand works and persists
- [ ] View switching works and persists
- [ ] No RPC errors in console
- [ ] No backend UiService/ViewService references
- [ ] localStorage contains expected data
- [ ] Multiple windows have independent UI state (if applicable)

---

## Rollback Plan

If issues arise:
1. Revert frontend changes (restore RPC calls)
2. Restore backend services (UiService, ViewService)
3. Restore RPC handlers
4. Test with old architecture
5. Debug issues before re-attempting migration

