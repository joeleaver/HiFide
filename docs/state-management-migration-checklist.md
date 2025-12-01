# State Management Migration - Implementation Checklist

**Goal**: Move all UI state from backend to frontend-only  
**Estimated Time**: 4-5 hours  
**Risk Level**: Low

---

## Pre-Migration

- [ ] Review audit documents:
  - [ ] `docs/state-management-audit.md` (detailed analysis)
  - [ ] `docs/state-management-crossover-summary.md` (visual diagrams)
  - [ ] `docs/state-management-migration-guide.md` (implementation steps)
  - [ ] `docs/state-management-audit-summary.md` (executive summary)

- [ ] Create feature branch: `refactor/ui-state-to-frontend`

- [ ] Backup current state (git commit)

---

## Phase 1: Frontend Changes (2-3 hours)

### 1.1 Create Persistence Helper

- [ ] Create `src/store/utils/uiPersistence.ts`
  - [ ] `loadUiState()` function
  - [ ] `saveUiState()` function
  - [ ] `saveUiStateDebounced()` function
  - [ ] Define `PersistedUiState` interface

### 1.2 Update useUiStore

- [ ] Import persistence helpers
- [ ] Initialize state from localStorage on store creation
- [ ] Add `currentView` field (move from ViewService)
- [ ] Update all setter actions to persist to localStorage:
  - [ ] `setSessionPanelWidth` - debounced
  - [ ] `setMetaPanelWidth` - debounced
  - [ ] `setMetaPanelOpen` - immediate
  - [ ] `setDebugPanelCollapsed` - immediate
  - [ ] `setDebugPanelHeight` - debounced
  - [ ] `setContextInspectorCollapsed` - immediate
  - [ ] `setContextInspectorHeight` - debounced
  - [ ] `setTokensCostsCollapsed` - immediate
  - [ ] `setTokensCostsHeight` - debounced
  - [ ] `setRightPaneCollapsed` - immediate
  - [ ] `setCurrentViewLocal` - immediate (rename to `setCurrentView`)
- [ ] Remove comments about "syncing from main store"

### 1.3 Update Components

- [ ] **ContextInspectorPanel.tsx**
  - [ ] Remove `useEffect` that calls `ui.getWindowState`
  - [ ] Remove RPC call in `onToggleCollapse`
  - [ ] Remove RPC call in `onHeightChange`
  - [ ] Test: Panel state persists across app restarts

- [ ] **TokensCostsPanel.tsx**
  - [ ] Remove `useEffect` that calls `ui.getWindowState`
  - [ ] Remove RPC call in `onToggleCollapse`
  - [ ] Remove RPC call in `onHeightChange`
  - [ ] Test: Panel state persists across app restarts

- [ ] **AgentDebugPanel.tsx**
  - [ ] Remove `useEffect` that calls `ui.getWindowState`
  - [ ] Remove RPC call in `onToggleCollapse`
  - [ ] Remove RPC call in `onHeightChange`
  - [ ] Test: Panel state persists across app restarts

- [ ] **FlowView.tsx**
  - [ ] Remove `ui.getWindowState` RPC call in `loadFlowEditor`
  - [ ] Use `useUiStore` state directly (already initialized from localStorage)
  - [ ] Test: Meta panel state persists across app restarts

- [ ] **ActivityBar.tsx**
  - [ ] Change from `view.set` RPC to `useUiStore.setCurrentView`
  - [ ] Use `useUiStore.currentView` for highlighting
  - [ ] Test: View selection persists across app restarts

- [ ] **App.tsx**
  - [ ] Use `useUiStore.currentView` for routing
  - [ ] Remove any `view.get` RPC calls
  - [ ] Test: Current view persists across app restarts

- [ ] **workspaceUi.ts**
  - [ ] Remove `view.set` RPC calls
  - [ ] Use `useUiStore.setCurrentView` instead
  - [ ] Test: View changes work correctly

### 1.4 Optional: Migration from Backend

- [ ] Add one-time migration function in `src/store/ui.ts`
- [ ] Call migration on app startup (in `src/lib/backend/bootstrap.ts`)
- [ ] Test: Existing user preferences migrate correctly

---

## Phase 2: Backend Cleanup (1 hour)

### 2.1 Remove Services

- [ ] Delete `electron/services/UiService.ts`
- [ ] Delete `electron/services/ViewService.ts`

### 2.2 Update Service Registry

- [ ] **electron/services/index.ts**
  - [ ] Remove `import { UiService }` line
  - [ ] Remove `import { ViewService }` line
  - [ ] Remove `let uiService: UiService` declaration
  - [ ] Remove `let viewService: ViewService` declaration
  - [ ] Remove `uiService = new UiService()` initialization
  - [ ] Remove `viewService = new ViewService()` initialization
  - [ ] Remove `registry.register('ui', uiService)` registration
  - [ ] Remove `registry.register('view', viewService)` registration
  - [ ] Remove `export { UiService }` export
  - [ ] Remove `export { ViewService }` export

### 2.3 Update RPC Handlers

- [ ] **electron/backend/ws/handlers/ui-handlers.ts**
  - [ ] Remove `ui.getWindowState` method
  - [ ] Remove `ui.updateWindowState` method
  - [ ] Remove `ui.toggleWindowState` method
  - [ ] Remove `view.get` method
  - [ ] Remove `view.set` method
  - [ ] Keep `window.*` methods (window controls)
  - [ ] Keep `explorer.*` methods (file tree state)
  - [ ] Keep `editor.*` methods (opened file)

### 2.4 Update Snapshot Builder (if needed)

- [ ] **electron/backend/ws/snapshot.ts**
  - [ ] Remove any UI state from workspace snapshot (if present)
  - [ ] Verify snapshot only contains domain data

---

## Phase 3: Testing (1 hour)

### 3.1 Functional Testing

- [ ] UI state persists across app restarts
- [ ] Panel resize works and persists
- [ ] Panel collapse/expand works and persists
- [ ] View switching works and persists
- [ ] Session panel width persists (workspace-specific if implemented)
- [ ] Main collapsed state persists (workspace-specific if implemented)

### 3.2 Error Testing

- [ ] No RPC errors in console
- [ ] No "method not found" errors
- [ ] No backend service errors
- [ ] localStorage contains expected data structure

### 3.3 Multi-Window Testing (if applicable)

- [ ] Each window has independent UI state
- [ ] Closing one window doesn't affect others
- [ ] Opening new window uses default or persisted state

### 3.4 Edge Cases

- [ ] localStorage quota not exceeded
- [ ] Invalid localStorage data handled gracefully
- [ ] Missing localStorage data uses defaults
- [ ] Debounced saves work correctly (no data loss)

---

## Phase 4: Documentation (30 minutes)

- [ ] Update `docs/architecture-today.md` to reflect new pattern
- [ ] Update `docs/service-patterns.md` to remove UiService/ViewService
- [ ] Add localStorage persistence pattern to docs
- [ ] Update any diagrams showing state management
- [ ] Mark UiService/ViewService as removed in cleanup docs

---

## Post-Migration

- [ ] Code review
- [ ] Merge to main branch
- [ ] Monitor for issues in production
- [ ] Close related issues/tickets
- [ ] Celebrate clean architecture! 🎉

---

## Rollback Plan (if needed)

If critical issues arise:

1. [ ] Revert feature branch
2. [ ] Restore backend services (UiService, ViewService)
3. [ ] Restore RPC handlers
4. [ ] Restore component RPC calls
5. [ ] Test with old architecture
6. [ ] Debug issues
7. [ ] Re-attempt migration with fixes

---

## Success Criteria

✅ All UI state managed by frontend only  
✅ No backend UiService or ViewService  
✅ No `ui.*` or `view.*` RPC calls  
✅ UI state persists to localStorage  
✅ All tests passing  
✅ No console errors  
✅ Clean separation of concerns  

---

## Notes

- Keep workspace-specific layout (session panel width, main collapsed) in `.hifide-private/settings.json` via WorkspaceService
- All other UI state goes to localStorage
- Debounce high-frequency updates (panel resize) to avoid excessive writes
- Use immediate persistence for low-frequency updates (collapse/expand)

