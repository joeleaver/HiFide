# Slice Dependency Map

This document maps dependencies between slices to inform migration order.

## Dependency Graph

```
Legend:
→ depends on
* no dependencies (can be migrated first)

Tier 1 (No Dependencies):
* debug.slice.ts
* view.slice.ts
* ui.slice.ts

Tier 2 (Depends on Tier 1):
planning.slice.ts → debug, session, flowEditor
indexing.slice.ts → (standalone, complex async)

Tier 3 (Orchestration):
app.slice.ts → workspace, session, provider, settings, view
workspace.slice.ts → app, indexing, kanban, knowledgeBase
explorer.slice.ts → workspace

Tier 4 (Domain Logic):
provider.slice.ts → settings
settings.slice.ts → provider (circular!)
tools.slice.ts → workspace
kanban.slice.ts → workspace
knowledgeBase.slice.ts → workspace

Tier 5 (Critical):
terminal.slice.ts → (standalone, complex state)
session.slice.ts → settings, terminal, workspace (1700+ lines!)
flowEditor.slice.ts → provider, session (complex graph logic)
```

## Detailed Dependencies

### debug.slice.ts
**Dependencies:** None
**Used by:** planning, app, workspace
**Complexity:** Low (65 lines)
**Notes:** Just manages array of log entries

### view.slice.ts
**Dependencies:** appBridge (external call)
**Used by:** app
**Complexity:** Low (45 lines)
**Notes:** Single string state + one external call

### ui.slice.ts
**Dependencies:** electronStorage (persistence)
**Used by:** None (UI state only)
**Complexity:** Low (136 lines)
**Notes:** WindowState object with persistence

### planning.slice.ts
**Dependencies:** 
- debug (for logging)
- session (for flowInit, feRequestId)
- flowEditor (for flow execution)
**Used by:** None
**Complexity:** Medium (200+ lines)
**Notes:** Approved plans, step execution

### app.slice.ts
**Dependencies:**
- workspace (setWorkspaceRoot, loadWorkspace)
- session (loadSessions, initializeSession)
- provider (loadModels, validateProviders)
- settings (loadApiKeys)
- view (setCurrentView)
**Used by:** workspace (circular)
**Complexity:** Medium (orchestration)
**Notes:** App initialization coordinator

### workspace.slice.ts
**Dependencies:**
- app (setStartupMessage, setWorkspaceBoot)
- indexing (rebuild, status)
- kanban (startWatcher, stopWatcher)
- knowledgeBase (startWatcher, stopWatcher)
**Used by:** app (circular), explorer, tools, kanban, session
**Complexity:** High (300+ lines)
**Notes:** Workspace lifecycle, file watching

### explorer.slice.ts
**Dependencies:**
- workspace (workspaceRoot)
**Used by:** None
**Complexity:** Medium
**Notes:** File tree state

### indexing.slice.ts
**Dependencies:** None (uses getIndexer from core/state)
**Used by:** workspace
**Complexity:** Medium (async operations)
**Notes:** Code indexing status and operations

### provider.slice.ts
**Dependencies:**
- settings (for pricing, API keys)
**Used by:** app, flowEditor, planning
**Complexity:** High (model management)
**Notes:** Provider/model selection, validation

### settings.slice.ts
**Dependencies:**
- provider (for model validation)
**Used by:** app, provider (circular), session
**Complexity:** High (API keys, pricing)
**Notes:** Settings persistence and validation

### tools.slice.ts
**Dependencies:**
- workspace (workspaceRoot)
**Used by:** None
**Complexity:** Medium
**Notes:** Tool configuration

### kanban.slice.ts
**Dependencies:**
- workspace (workspaceRoot)
**Used by:** workspace
**Complexity:** High (board state)
**Notes:** Kanban board management

### knowledgeBase.slice.ts
**Dependencies:**
- workspace (workspaceRoot)
**Used by:** workspace
**Complexity:** High (KB operations)
**Notes:** Knowledge base CRUD

### terminal.slice.ts
**Dependencies:** agentPty (external service)
**Used by:** session
**Complexity:** High (PTY management)
**Notes:** Terminal tabs, PTY sessions

### session.slice.ts
**Dependencies:**
- settings (calculateCost)
- terminal (clearAgentTerminals)
- workspace (workspaceRoot for persistence)
**Used by:** app, planning, flowEditor
**Complexity:** Very High (1700+ lines)
**Notes:** Chat sessions, messages, token usage, LLM lifecycle

### flowEditor.slice.ts
**Dependencies:**
- provider (selectedProvider, selectedModel, modelsByProvider, pricingConfig)
- session (for flow execution context)
**Used by:** planning
**Complexity:** Very High (complex graph logic)
**Notes:** Flow graph, node execution, context management

## Migration Order Recommendation

### Phase 1: Foundation (Week 1)
1. debug.slice.ts (no deps)
2. view.slice.ts (no deps)
3. ui.slice.ts (no deps)

### Phase 2: Medium Complexity (Week 2)
4. indexing.slice.ts (no deps, but async)
5. explorer.slice.ts (depends on workspace, but simple)
6. tools.slice.ts (depends on workspace, but simple)

### Phase 3: Orchestration (Week 3)
7. Break provider ↔ settings circular dependency
8. provider.slice.ts
9. settings.slice.ts
10. app.slice.ts (orchestration)

### Phase 4: Workspace & Domain (Week 4)
11. kanban.slice.ts
12. knowledgeBase.slice.ts
13. workspace.slice.ts (complex, many deps)

### Phase 5: Critical (Week 5)
14. terminal.slice.ts (complex state)
15. planning.slice.ts (depends on session, flowEditor)

### Phase 6: Most Complex (Week 6)
16. session.slice.ts (1700+ lines, many deps)
17. flowEditor.slice.ts (complex graph logic)

## Breaking Circular Dependencies

### provider ↔ settings
**Solution:** Use events instead of direct calls
```typescript
// Instead of:
settings.validateProvider(provider)

// Use:
events.emit('provider.changed', { provider })
// SettingsService listens and validates
```

### app ↔ workspace
**Solution:** Dependency injection
```typescript
// WorkspaceService receives AppService in constructor
constructor(private appService: AppService) {}

// Can call appService.setStartupMessage()
```

