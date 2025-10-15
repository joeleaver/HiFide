# Comprehensive Refactoring Plan: Splitting Monolithic Files

**Status:** Planning Phase  
**Created:** 2025-10-13  
**Target Files:**
- `electron/main.ts` (3,975 lines, 194.90 KB)
- `src/store/app.ts` (2,020 lines, 82.85 KB)

---

## 🎯 Executive Summary

This document outlines a comprehensive plan to refactor two monolithic files that have grown too large to maintain effectively. The refactoring will improve code organization, maintainability, testability, and developer experience without changing any functionality.

### Current Problems

**electron/main.ts:**
- 72 IPC handlers mixed together without clear organization
- Multiple concerns: window management, file system, PTY, LLM providers, indexing, flows, etc.
- Shared state scattered throughout (window reference, provider keys, PTY sessions)
- Difficult to test individual components
- Poor separation of concerns

**src/store/app.ts:**
- 153+ action methods in a single store
- Multiple domains: workspace, terminals, sessions, providers, pricing, etc.
- Massive state object with mixed responsibilities
- Highly interconnected domains requiring careful state management
- Performance implications from large store

---

## 🏗️ Architecture Overview

### Design Principles

1. **Single Responsibility** - Each module has one clear purpose
2. **Explicit Dependencies** - Clear imports and exports
3. **Shared State Management** - Centralized state for cross-cutting concerns
4. **Type Safety** - Shared type definitions across modules
5. **Testability** - Each module can be tested in isolation
6. **Gradual Migration** - Phased approach with validation at each step

---

## 📁 Phase 1: Refactor electron/main.ts

### Proposed File Structure

```
electron/
├── main.ts                    # Entry point (minimal, ~100 lines)
├── types/
│   └── index.ts              # Shared type definitions
├── core/
│   ├── state.ts              # Shared application state
│   ├── window.ts             # Window creation and management
│   └── app.ts                # App lifecycle and initialization
├── ipc/
│   ├── registry.ts           # IPC handler registration
│   ├── secrets.ts            # API key management, provider validation
│   ├── filesystem.ts         # File operations, directory watching
│   ├── sessions.ts           # Session persistence and management
│   ├── pty.ts                # Terminal/PTY operations
│   ├── llm.ts                # LLM provider communication
│   ├── indexing.ts           # Code indexing and search
│   ├── flows.ts              # Flow execution and management
│   ├── workspace.ts          # Workspace and project management
│   ├── refactoring.ts        # TypeScript refactoring operations
│   ├── edits.ts              # File editing operations
│   ├── planning.ts           # Planning operations
│   ├── capabilities.ts       # Provider capabilities
│   └── menu.ts               # Menu popup and view management
└── utils/
    ├── security.ts           # Output redaction, command validation
    └── logging.ts            # PTY logging and event tracking
```

### Module Breakdown

#### **electron/types/index.ts** (NEW)
Shared type definitions used across modules:
```typescript
export type PtySession = { p: IPty; wcId: number; log?: boolean }
export type FileEdit = { ... }
export type StreamHandle = { cancel: () => void }
export type FlowHandle = { ... }
// ... etc
```

#### **electron/core/state.ts** (NEW)
Centralized shared state for cross-cutting concerns:
```typescript
export const appState = {
  window: null as BrowserWindow | null,
  providerKeys: new Map<string, string>(),
  ptySessions: new Map<string, PtySession>(),
  inflightRequests: new Map<string, StreamHandle>(),
  inflightFlows: new Map<string, FlowHandle>(),
}

export function getWindow(): BrowserWindow | null { ... }
export function setWindow(win: BrowserWindow | null): void { ... }
export function getProviderKey(provider: string): Promise<string | null> { ... }
// ... etc
```

#### **electron/core/window.ts** (~200 lines)
Window creation, state persistence, and management:
- `createWindow()` - Window creation with saved state
- `loadWindowState()` / `saveWindowState()` - State persistence
- Window event handlers (resize, move, maximize, etc.)

#### **electron/core/app.ts** (~100 lines)
App lifecycle and initialization:
- App ready handler
- Menu building
- Cleanup on quit
- Global error handling

#### **electron/ipc/registry.ts** (NEW)
Central IPC handler registration:
```typescript
import { ipcMain } from 'electron'
import { registerSecretsHandlers } from './secrets'
import { registerFilesystemHandlers } from './filesystem'
// ... etc

export function registerAllHandlers() {
  registerSecretsHandlers(ipcMain)
  registerFilesystemHandlers(ipcMain)
  registerPtyHandlers(ipcMain)
  registerLlmHandlers(ipcMain)
  registerIndexingHandlers(ipcMain)
  registerFlowsHandlers(ipcMain)
  registerWorkspaceHandlers(ipcMain)
  registerRefactoringHandlers(ipcMain)
  registerEditsHandlers(ipcMain)
  registerPlanningHandlers(ipcMain)
  registerCapabilitiesHandlers(ipcMain)
  registerMenuHandlers(ipcMain)
  registerSessionsHandlers(ipcMain)
}
```

#### **electron/ipc/secrets.ts** (~150 lines)
API key management and provider validation:
- `secrets:set` / `secrets:setFor` / `secrets:getFor`
- `secrets:validateFor` - Provider API key validation
- `secrets:presence` - Check which providers have keys
- Provider key storage (electron-store)
- Presence broadcasting

#### **electron/ipc/filesystem.ts** (~200 lines)
File system operations:
- `fs:getCwd` / `fs:readFile` / `fs:readDir`
- `fs:watchStart` / `fs:watchStop` - Directory watching
- File watch event routing
- Recursive directory watching utilities

#### **electron/ipc/sessions.ts** (~100 lines)
Session persistence:
- `sessions:list` / `sessions:load` / `sessions:save` / `sessions:delete`
- Session directory management
- Session file I/O

#### **electron/ipc/pty.ts** (~300 lines)
Terminal/PTY operations:
- `pty:create` / `pty:write` / `pty:resize` / `pty:dispose`
- `pty:exec-agent` - Agent-initiated command execution with policy gating
- `agent-pty:attach` / `agent-pty:detach` - Agent PTY attachment
- PTY session management
- Command risk assessment
- PTY logging integration

#### **electron/ipc/llm.ts** (~500 lines)
LLM provider communication:
- `llm:start` / `llm:cancel` - Basic chat streaming
- `llm:auto` - Auto router (chat vs tools)
- `llm:agentStart` - Agent-mode streaming with tools
- `models:list` / `models:cheapestClassifier` - Model management
- Provider-specific streaming logic
- Token usage tracking
- Request lifecycle management

#### **electron/ipc/indexing.ts** (~150 lines)
Code indexing and search:
- `index:rebuild` / `index:status` / `index:cancel` / `index:clear`
- `index:search` - Semantic code search
- Indexer instance management
- Progress event broadcasting

#### **electron/ipc/flows.ts** (~800 lines)
Flow execution and management:
- `flows:list` / `flows:load` / `flows:save`
- `flow:run` / `flow:stop` / `flow:pause` / `flow:resume` / `flow:step`
- `flow:setBreakpoints`
- `flowState:load` / `flowState:save` - Flow state persistence
- `flow:trace:export` - Trace export
- Flow graph execution engine
- Breakpoint and debugging support

#### **electron/ipc/workspace.ts** (~200 lines)
Workspace and project management:
- `workspace:get-root` / `workspace:set-root`
- `workspace:open-folder-dialog`
- `workspace:bootstrap` - Initialize .hifide-public and .hifide-private
- Git repository detection
- .gitignore management

#### **electron/ipc/refactoring.ts** (~300 lines)
TypeScript refactoring operations:
- `tsrefactor:rename` / `tsrefactor:organizeImports`
- `tsrefactor:addExportNamed` / `tsrefactor:addExportFrom`
- `tsrefactor:moveFile` / `tsrefactor:ensureDefaultExport`
- `tsrefactor:extractFunction` / `tsrefactor:suggestParams`
- `tsrefactor:inlineVariable` / `tsrefactor:inlineFunction`
- `tsrefactor:defaultToNamed` / `tsrefactor:namedToDefault`
- Integration with ts-morph refactoring utilities

#### **electron/ipc/edits.ts** (~100 lines)
File editing operations:
- `edits:apply` - Apply file edits with dry-run support
- `edits:propose` - Propose edits using LLM
- Edit validation and verification

#### **electron/ipc/planning.ts** (~50 lines)
Planning operations:
- `planning:save-approved` / `planning:load-approved`
- Approved plan persistence in .hifide-private

#### **electron/ipc/capabilities.ts** (~30 lines)
Provider capabilities:
- `capabilities:get` - Get provider capability matrix

#### **electron/ipc/menu.ts** (~100 lines)
Menu management:
- `menu:popup` - Show context menus
- `app:set-view` - Update menu state based on current view
- `window:minimize` / `window:maximize` / `window:close` / `window:isMaximized`

#### **electron/utils/security.ts** (~100 lines)
Security utilities:
- `redactOutput()` - Redact sensitive data from terminal output
- `isRiskyCommand()` - Assess command risk level
- Pattern matching for secrets and dangerous commands

#### **electron/utils/logging.ts** (~150 lines)
PTY logging and event tracking:
- `logEvent()` - Log PTY events to disk
- `logsRoot()` - Get logs directory
- Event formatting and persistence

#### **electron/main.ts** (SLIMMED DOWN, ~100 lines)
Minimal entry point:
```typescript
import { app } from 'electron'
import { createWindow } from './core/window'
import { buildMenu } from './core/app'
import { registerAllHandlers } from './ipc/registry'
import { initAgentSessionsCleanup } from './session/agentSessions'
import { registerRateLimitIpc } from './providers/ratelimit'

app.whenReady().then(() => {
  registerRateLimitIpc(ipcMain)
  registerAllHandlers()
  initAgentSessionsCleanup()
  createWindow()
  buildMenu()
})

// App lifecycle handlers
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

---

## 📁 Phase 2: Refactor src/store/app.ts

### Proposed File Structure (Zustand Slices Pattern)

```
src/store/
├── index.ts                  # Combined store export
├── slices/
│   ├── app.ts               # Core app state (view, initialization)
│   ├── workspace.ts         # Workspace root, recent folders, file explorer
│   ├── providers.ts         # Provider validation, model management, API keys
│   ├── sessions.ts          # Chat sessions, messages, conversation state
│   ├── terminals.ts         # Terminal instances, PTY sessions, tab management
│   ├── settings.ts          # User preferences, pricing config, rate limits
│   ├── indexing.ts          # Code indexing status and search
│   ├── llm.ts               # LLM request lifecycle, streaming, token usage
│   └── debug.ts             # Debug logs, activity tracking, metrics
└── types.ts                 # Shared store types
```

### Why Slices Instead of Separate Stores?

Your domains are **highly interconnected**:
- Sessions need provider information
- Terminals need workspace root
- LLM requests need sessions and providers
- Settings affect multiple domains

**Zustand slices** provide:
- ✅ Single source of truth
- ✅ Easy cross-slice access
- ✅ Unified persistence
- ✅ Better TypeScript inference
- ✅ Simpler testing

### Module Breakdown

#### **src/store/types.ts** (NEW)
Shared type definitions:
```typescript
export type ViewType = 'agent' | 'explorer' | 'flowEditor' | 'sourceControl' | 'terminal' | 'settings'
export type Session = { ... }
export type PtySession = { ... }
export type TerminalInstance = { ... }
export type TokenUsage = { ... }
export type TokenCost = { ... }
// ... etc
```

#### **src/store/slices/app.ts** (~150 lines)
Core app state and initialization:
- Boot/initialization state
- View management (currentView, setCurrentView)
- Startup messages
- App initialization logic
- UI state (metaPanelOpen, sidebarCollapsed)

#### **src/store/slices/workspace.ts** (~200 lines)
Workspace and file explorer state:
- Workspace root management
- Recent folders tracking
- File explorer state (open folders, children cache)
- Directory loading and toggling
- File watching integration
- Folder opening logic

#### **src/store/slices/providers.ts** (~250 lines)
Provider and model management:
- Selected provider and model
- Provider validation state
- Available models per provider
- Default models per provider
- Settings API keys (temporary state)
- Model refresh logic
- Provider consistency enforcement

#### **src/store/slices/sessions.ts** (~300 lines)
Chat session management:
- Sessions list and current session
- Session CRUD operations (create, rename, delete, select)
- Message management (add user/assistant messages)
- Token usage tracking per session
- Cost tracking per session
- Conversation state (provider-specific metadata)
- Session persistence integration

#### **src/store/slices/terminals.ts** (~400 lines)
Terminal and PTY management:
- Terminal panel UI state (open/collapsed, height)
- Terminal tabs per context (agent/explorer)
- Active terminal tracking
- Terminal instances (xterm + fitAddon)
- PTY sessions and routing
- Terminal lifecycle (mount, remount, unmount, fit)
- PTY operations (create, write, resize, dispose)
- PTY data subscription

#### **src/store/slices/settings.ts** (~250 lines)
User preferences and configuration:
- Auto-approve settings
- Auto-enforce edits schema
- Pricing configuration
- Rate limit configuration
- Settings persistence
- Pricing calculations
- Rate limit management

#### **src/store/slices/indexing.ts** (~150 lines)
Code indexing state:
- Index status and progress
- Index query and results
- Index operations (rebuild, clear, search)
- Progress subscription
- Context refresh state

#### **src/store/slices/llm.ts** (~300 lines)
LLM request lifecycle:
- Current request ID and streaming state
- Chunk statistics
- Retry count
- Request routing history
- IPC subscription management
- Activity/badge tracking
- Response schema building
- Chat request initiation
- Request cancellation

#### **src/store/slices/debug.ts** (~100 lines)
Debug and monitoring:
- Debug logs
- Debug panel state
- Agent metrics
- Log management (add, clear)
- Metrics subscription

#### **src/store/index.ts** (NEW, ~100 lines)
Combined store using slices pattern:
```typescript
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createAppSlice } from './slices/app'
import { createWorkspaceSlice } from './slices/workspace'
import { createProvidersSlice } from './slices/providers'
import { createSessionsSlice } from './slices/sessions'
import { createTerminalsSlice } from './slices/terminals'
import { createSettingsSlice } from './slices/settings'
import { createIndexingSlice } from './slices/indexing'
import { createLlmSlice } from './slices/llm'
import { createDebugSlice } from './slices/debug'

export const useAppStore = create(
  persist(
    (...a) => ({
      ...createAppSlice(...a),
      ...createWorkspaceSlice(...a),
      ...createProvidersSlice(...a),
      ...createSessionsSlice(...a),
      ...createTerminalsSlice(...a),
      ...createSettingsSlice(...a),
      ...createIndexingSlice(...a),
      ...createLlmSlice(...a),
      ...createDebugSlice(...a),
    }),
    {
      name: 'hifide:app',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        // Only persist specific fields from each slice
        currentView: state.currentView,
        workspaceRoot: state.workspaceRoot,
        recentFolders: state.recentFolders,
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        // ... etc
      }),
    }
  )
)
```

---

## 🔄 Implementation Strategy

### Phase 1: Electron Main Process (Week 1-2)

#### Step 1: Setup Foundation (~2 days)
1. Create directory structure
2. Create `electron/types/index.ts` with all shared types
3. Create `electron/core/state.ts` with shared state management
4. Create `electron/utils/security.ts` and `electron/utils/logging.ts`
5. Write unit tests for utilities

#### Step 2: Extract Simple Modules (~3 days)
Start with isolated, low-dependency modules:
1. `electron/ipc/capabilities.ts` (simplest)
2. `electron/ipc/secrets.ts`
3. `electron/ipc/sessions.ts`
4. `electron/ipc/planning.ts`
5. Test each module independently

#### Step 3: Extract Medium Complexity Modules (~4 days)
1. `electron/ipc/filesystem.ts`
2. `electron/ipc/workspace.ts`
3. `electron/ipc/indexing.ts`
4. `electron/ipc/edits.ts`
5. `electron/ipc/refactoring.ts`
6. `electron/ipc/menu.ts`
7. Test integration with shared state

#### Step 4: Extract Complex Modules (~5 days)
1. `electron/ipc/pty.ts` (complex state management)
2. `electron/ipc/llm.ts` (complex streaming logic)
3. `electron/ipc/flows.ts` (largest, most complex)
4. Extensive integration testing

#### Step 5: Create Core Modules (~2 days)
1. `electron/core/window.ts`
2. `electron/core/app.ts`
3. `electron/ipc/registry.ts`
4. Update `electron/main.ts` to minimal entry point

#### Step 6: Integration and Testing (~3 days)
1. Update all imports across codebase
2. Run full test suite
3. Manual testing of all features
4. Fix any issues discovered

### Phase 2: Frontend Store (Week 3-4)

#### Step 1: Setup Foundation (~1 day)
1. Create `src/store/slices/` directory
2. Create `src/store/types.ts` with shared types
3. Study current store dependencies

#### Step 2: Extract Simple Slices (~3 days)
1. `src/store/slices/debug.ts` (simplest)
2. `src/store/slices/app.ts` (core, minimal dependencies)
3. `src/store/slices/indexing.ts`
4. Test each slice independently

#### Step 3: Extract Medium Complexity Slices (~4 days)
1. `src/store/slices/workspace.ts`
2. `src/store/slices/settings.ts`
3. `src/store/slices/providers.ts`
4. Test cross-slice interactions

#### Step 4: Extract Complex Slices (~5 days)
1. `src/store/slices/sessions.ts` (complex state)
2. `src/store/slices/llm.ts` (complex lifecycle)
3. `src/store/slices/terminals.ts` (most complex)
4. Extensive testing

#### Step 5: Create Combined Store (~2 days)
1. Create `src/store/index.ts` with slice composition
2. Configure persistence (partialize)
3. Update all component imports
4. Test store composition

#### Step 6: Integration and Testing (~3 days)
1. Update all component imports
2. Run full test suite
3. Manual testing of all features
4. Performance testing
5. Fix any issues discovered

---

## ✅ Testing Strategy

### Unit Tests

**Electron Modules:**
- Mock `ipcMain` for handler registration
- Test each handler function independently
- Mock shared state and dependencies
- Test error handling and edge cases

**Store Slices:**
- Test each slice in isolation
- Mock IPC calls
- Test state updates and side effects
- Test persistence logic

### Integration Tests

**Electron:**
- Test IPC communication end-to-end
- Test shared state coordination
- Test PTY lifecycle
- Test LLM streaming

**Store:**
- Test cross-slice interactions
- Test store composition
- Test persistence and rehydration
- Test concurrent updates

### End-to-End Tests

- Test complete user workflows
- Test all views (agent, explorer, settings, etc.)
- Test terminal operations
- Test LLM chat and agent mode
- Test file operations
- Test session management

### Performance Tests

- Measure store update performance
- Measure component re-render frequency
- Measure memory usage
- Compare before/after metrics

---

## 🎯 Success Criteria

### Functional Requirements
- ✅ All existing features work identically
- ✅ No regressions in functionality
- ✅ All tests pass
- ✅ No console errors or warnings

### Code Quality Requirements
- ✅ Each module < 500 lines
- ✅ Clear separation of concerns
- ✅ No circular dependencies
- ✅ Consistent naming conventions
- ✅ Comprehensive JSDoc comments

### Performance Requirements
- ✅ No degradation in app startup time
- ✅ No degradation in UI responsiveness
- ✅ Store updates remain efficient
- ✅ Memory usage stays within acceptable range

### Developer Experience Requirements
- ✅ Easier to find relevant code
- ✅ Easier to add new features
- ✅ Easier to test changes
- ✅ Better TypeScript inference
- ✅ Clear module boundaries

---

## ⚠️ Risk Mitigation

### Risk: Breaking Changes During Migration

**Mitigation:**
- Work in feature branch
- Keep original files as `.backup`
- Incremental migration with validation at each step
- Comprehensive test coverage before starting
- Ability to rollback at any point

### Risk: Circular Dependencies

**Mitigation:**
- Shared state in `core/state.ts` prevents circular deps
- Clear dependency hierarchy (utils → core → ipc)
- Dependency graph visualization
- Linting rules to prevent circular imports

### Risk: Performance Degradation

**Mitigation:**
- Performance benchmarks before starting
- Monitor performance at each step
- Profile store updates and re-renders
- Optimize if needed (memoization, selectors)

### Risk: Lost Functionality

**Mitigation:**
- Comprehensive test suite
- Manual testing checklist
- Feature flag system for gradual rollout
- User acceptance testing

### Risk: Merge Conflicts

**Mitigation:**
- Coordinate with team on timing
- Freeze other major changes during migration
- Communicate progress regularly
- Quick merge after validation

---

## 📊 Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1: Electron Main | 2-3 weeks | Modular main process |
| Phase 2: Frontend Store | 2-3 weeks | Modular store with slices |
| Testing & Validation | 1 week | Fully tested refactoring |
| **Total** | **5-7 weeks** | **Production-ready code** |

---

## 🚀 Next Steps

1. **Review and Approve Plan** - Team review and sign-off
2. **Setup Branch** - Create feature branch `refactor/split-monoliths`
3. **Baseline Metrics** - Capture current performance and test coverage
4. **Begin Phase 1** - Start with electron/main.ts refactoring
5. **Regular Check-ins** - Daily progress updates and blockers
6. **Continuous Testing** - Test at each milestone
7. **Final Review** - Code review and merge to main

---

## 📚 References

- [Zustand Slices Pattern](https://docs.pmnd.rs/zustand/guides/slices-pattern)
- [Electron IPC Best Practices](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Testing Electron Apps](https://www.electronjs.org/docs/latest/tutorial/automated-testing)

---

**Document Version:** 2.0
**Last Updated:** 2025-10-13
**Author:** AI Assistant (Augment Agent)
**Status:** Ready for Review


