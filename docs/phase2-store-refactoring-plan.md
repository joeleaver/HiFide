# Phase 2: Frontend Store Refactoring Plan

## 📊 Current State Analysis

**File:** `src/store/app.ts`  
**Size:** 2,278 lines  
**Problem:** Monolithic Zustand store with all application state and logic in one file

### Current Responsibilities (12 domains)

1. **App Initialization** - Boot/startup logic
2. **View Management** - Current view state
3. **Workspace** - Folder management, file watching
4. **File Explorer** - Directory tree state
5. **Model/Provider** - LLM provider and model selection
6. **Settings** - API keys, auto-approve, pricing, rate limits
7. **Planning** - Approved plans and execution
8. **UI State** - Panels, sidebar, meta panel
9. **Indexing** - Code indexing and search
10. **Terminal/PTY** - Terminal tabs, sessions, xterm instances
11. **Sessions/Chat** - Chat sessions, messages, token tracking
12. **Debug Logging** - Debug panel and logs

---

## 🎯 Refactoring Strategy: Zustand Slices Pattern

We'll use the **Zustand slices pattern** to split the monolithic store into focused domain slices while maintaining a single combined store.

### Why Slices Instead of Separate Stores?

✅ **Interconnected domains** - Many domains need to access each other's state  
✅ **Single source of truth** - One store, one subscription  
✅ **Unified persistence** - Single localStorage key  
✅ **Type-safe cross-slice access** - TypeScript ensures correctness  
✅ **Better performance** - Fewer re-renders with proper selectors  

---

## 📁 Proposed Structure

```
src/store/
├── index.ts                    # Combined store (main entry point)
├── types.ts                    # Shared types
├── slices/
│   ├── app.slice.ts           # App initialization
│   ├── view.slice.ts          # View management
│   ├── workspace.slice.ts     # Workspace and file watching
│   ├── explorer.slice.ts      # File explorer tree
│   ├── provider.slice.ts      # Model/provider selection
│   ├── settings.slice.ts      # Settings (API keys, pricing, rate limits)
│   ├── planning.slice.ts      # Planning and execution
│   ├── ui.slice.ts            # UI state (panels, sidebar)
│   ├── indexing.slice.ts      # Code indexing
│   ├── terminal.slice.ts      # Terminal/PTY management
│   ├── session.slice.ts       # Chat sessions and messages
│   └── debug.slice.ts         # Debug logging
└── utils/
    ├── persistence.ts         # localStorage helpers
    └── constants.ts           # Shared constants
```

---

## 🏗️ Implementation Plan

### Phase 2.1: Setup Foundation (Week 1)

**Goal:** Create infrastructure for slices pattern

**Tasks:**
1. Create `src/store/types.ts` with shared types
2. Create `src/store/utils/persistence.ts` with localStorage helpers
3. Create `src/store/utils/constants.ts` with LS_KEYS
4. Create `src/store/slices/` directory
5. Set up testing infrastructure

**Deliverables:**
- ✅ Shared types extracted
- ✅ Utility functions extracted
- ✅ Directory structure ready

---

### Phase 2.2: Extract Simple Slices (Week 2)

**Goal:** Extract independent slices with minimal cross-dependencies

**Slices to extract:**
1. **`view.slice.ts`** (~30 lines)
   - `currentView`, `setCurrentView`
   
2. **`ui.slice.ts`** (~80 lines)
   - `metaPanelOpen`, `setMetaPanelOpen`
   - `sidebarCollapsed`, `setSidebarCollapsed`
   - `debugPanelCollapsed`, `setDebugPanelCollapsed`
   - Terminal panel states (agent/explorer)

3. **`debug.slice.ts`** (~60 lines)
   - `debugLogs`, `addDebugLog`, `clearDebugLogs`

4. **`planning.slice.ts`** (~120 lines)
   - `approvedPlan`, `setApprovedPlan`
   - `saveApprovedPlan`, `loadApprovedPlan`
   - `executeApprovedPlanAutonomous`, `executeApprovedPlanFirstStep`

**Deliverables:**
- ✅ 4 simple slices extracted (~290 lines)
- ✅ Tests for each slice
- ✅ No breaking changes

---

### Phase 2.3: Extract Medium Complexity Slices (Week 3)

**Goal:** Extract slices with moderate cross-dependencies

**Slices to extract:**
1. **`app.slice.ts`** (~100 lines)
   - `appBootstrapping`, `startupMessage`
   - `initializeApp`, `setStartupMessage`

2. **`workspace.slice.ts`** (~200 lines)
   - `workspaceRoot`, `setWorkspaceRoot`
   - `recentFolders`, `addRecentFolder`, `clearRecentFolders`
   - `openFolder`, `hasUnsavedChanges`
   - `fileWatchCleanup`, `fileWatchEvent`
   - `refreshContext`, `ctxRefreshing`, `ctxResult`

3. **`explorer.slice.ts`** (~150 lines)
   - `explorerOpenFolders`, `explorerChildrenByDir`
   - `loadExplorerDir`, `toggleExplorerFolder`
   - `openFile`, `openedFile`

4. **`indexing.slice.ts`** (~180 lines)
   - `idxStatus`, `idxLoading`, `idxQuery`, `idxResults`, `idxProg`
   - `ensureIndexProgressSubscription`, `refreshIndexStatus`
   - `rebuildIndex`, `clearIndex`, `setIdxQuery`, `searchIndex`

**Deliverables:**
- ✅ 4 medium slices extracted (~630 lines)
- ✅ Tests for each slice
- ✅ Cross-slice dependencies documented

---

### Phase 2.4: Extract Complex Slices (Week 4)

**Goal:** Extract slices with heavy cross-dependencies

**Slices to extract:**
1. **`provider.slice.ts`** (~350 lines)
   - `selectedModel`, `setSelectedModel`
   - `selectedProvider`, `setSelectedProvider`
   - `autoRetry`, `setAutoRetry`
   - `ensureProviderModelConsistency`
   - `providerValid`, `setProviderValid`, `setProvidersValid`
   - `modelsByProvider`, `setModelsForProvider`
   - `refreshModels`, `refreshAllModels`
   - `defaultModels`, `setDefaultModel`
   - `routeHistory`, `pushRouteRecord`

2. **`settings.slice.ts`** (~400 lines)
   - API keys management
   - Auto-approve settings
   - Auto-enforce edits schema
   - Pricing configuration
   - Rate limit configuration

3. **`terminal.slice.ts`** (~500 lines)
   - Terminal tabs (agent/explorer)
   - Active terminal tracking
   - Terminal instances (xterm)
   - PTY sessions and routing
   - Mount/unmount/fit logic

4. **`session.slice.ts`** (~400 lines)
   - Sessions management
   - Current session tracking
   - Messages (user/assistant)
   - Token usage tracking
   - LLM request lifecycle
   - Activity/badge state

**Deliverables:**
- ✅ 4 complex slices extracted (~1,650 lines)
- ✅ Tests for each slice
- ✅ Cross-slice communication patterns established

---

### Phase 2.5: Create Combined Store (Week 5)

**Goal:** Combine all slices into single store

**Tasks:**
1. Create `src/store/index.ts` with combined store
2. Implement slice composition
3. Set up unified persistence
4. Add type-safe selectors
5. Update all imports throughout codebase

**Example structure:**
```typescript
// src/store/index.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createAppSlice } from './slices/app.slice'
import { createViewSlice } from './slices/view.slice'
// ... other slices

export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createAppSlice(...a),
      ...createViewSlice(...a),
      ...createWorkspaceSlice(...a),
      ...createExplorerSlice(...a),
      ...createProviderSlice(...a),
      ...createSettingsSlice(...a),
      ...createPlanningSlice(...a),
      ...createUiSlice(...a),
      ...createIndexingSlice(...a),
      ...createTerminalSlice(...a),
      ...createSessionSlice(...a),
      ...createDebugSlice(...a),
    }),
    {
      name: 'hifide:app',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist specific fields
        currentView: state.currentView,
        workspaceRoot: state.workspaceRoot,
        // ... other persisted fields
      }),
    }
  )
)
```

**Deliverables:**
- ✅ Combined store working
- ✅ All slices integrated
- ✅ Persistence working
- ✅ Type safety maintained

---

### Phase 2.6: Update Components (Week 6)

**Goal:** Update all React components to use new store structure

**Tasks:**
1. Update imports from `src/store/app` to `src/store`
2. Use proper selectors for performance
3. Remove any direct state mutations
4. Test all components

**Example migration:**
```typescript
// Before
import { useAppStore } from '../store/app'
const currentView = useAppStore(state => state.currentView)

// After
import { useAppStore } from '../store'
const currentView = useAppStore(state => state.currentView)
```

**Deliverables:**
- ✅ All components updated
- ✅ No breaking changes
- ✅ Performance optimized

---

### Phase 2.7: Testing & Cleanup (Week 7)

**Goal:** Comprehensive testing and cleanup

**Tasks:**
1. Unit tests for each slice
2. Integration tests for cross-slice interactions
3. E2E tests for critical flows
4. Performance testing
5. Remove old `app.ts` file
6. Update documentation

**Deliverables:**
- ✅ 90%+ test coverage
- ✅ All tests passing
- ✅ Documentation updated
- ✅ Old file removed

---

## 📊 Success Metrics

**Code Quality:**
- ✅ Each slice < 500 lines
- ✅ Clear separation of concerns
- ✅ No circular dependencies
- ✅ Type-safe throughout

**Performance:**
- ✅ No performance regression
- ✅ Fewer unnecessary re-renders
- ✅ Faster state updates

**Developer Experience:**
- ✅ Easy to find code
- ✅ Easy to add new features
- ✅ Easy to test
- ✅ Clear documentation

---

## 🎯 Timeline Summary

| Week | Phase | Deliverables | Lines |
|------|-------|--------------|-------|
| 1 | Foundation | Types, utils, structure | ~100 |
| 2 | Simple Slices | 4 slices | ~290 |
| 3 | Medium Slices | 4 slices | ~630 |
| 4 | Complex Slices | 4 slices | ~1,650 |
| 5 | Combined Store | Integration | ~100 |
| 6 | Update Components | Migration | - |
| 7 | Testing & Cleanup | Tests, docs | - |

**Total:** 7 weeks, 12 slices, ~2,770 lines (organized)

---

## 🚀 Next Steps

1. Review and approve this plan
2. Create feature branch: `refactor/phase2-store-slices`
3. Start with Phase 2.1 (Foundation)
4. Follow the week-by-week plan
5. Test continuously
6. Deploy when complete

---

## 📝 Notes

- This plan follows the same successful pattern from Phase 1
- Slices pattern is recommended by Zustand documentation
- Each slice is independently testable
- No breaking changes to existing functionality
- Can be done incrementally without blocking other work

