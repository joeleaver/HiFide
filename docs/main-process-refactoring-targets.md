# Main Process Refactoring Targets

**Date**: 2025-11-27
**Status**: ✅ COMPLETE - Phase 1 Implemented

## Overview

Analysis of the largest and most complex files in the `electron/` directory to identify refactoring opportunities.

---

## Top 25 Largest Files

| File | Lines | Priority | Complexity |
|------|-------|----------|------------|
| `backend/ws/server.ts` | 2513 | 🔴 CRITICAL | Very High |
| `services/SessionTimelineService.ts` | 1484 | 🟡 Medium | High |
| `flow-engine/llm-service.ts` | 1112 | 🟡 Medium | High |
| `flow-engine/scheduler.ts` | 1072 | 🟡 Medium | High |
| `indexing/indexer.ts` | 928 | 🟢 Low | Medium |
| `tools/workspace/searchWorkspace.ts` | 912 | 🟡 Medium | High |
| `services/SessionService.ts` | 608 | 🟢 Low | Medium |
| `services/IndexingService.ts` | 532 | 🟢 Low | Medium |
| `services/flowProfiles.ts` | 497 | 🟢 Low | Low |
| `services/TerminalService.ts` | 491 | 🟢 Low | Medium |
| `ipc/edits.ts` | 490 | 🟠 High | Medium |
| `services/ProviderService.ts` | 453 | 🟢 Low | Medium |
| `services/KanbanService.ts` | 451 | 🟢 Low | Low |
| `tools/text/grep.ts` | 440 | 🟢 Low | Medium |
| `tools/edits/applyPatch.ts` | 417 | 🟢 Low | Medium |
| `tools/astGrep.ts` | 409 | 🟠 High | Medium |
| `store/types.ts` | 378 | 🟢 Low | Low |
| `services/SettingsService.ts` | 377 | 🟢 Low | Low |
| `tools/code/applyEditsTargeted.ts` | 350 | 🟢 Low | Medium |
| `core/window.ts` | 349 | 🟢 Low | Medium |
| `tools/fs/readLines.ts` | 342 | 🟢 Low | Medium |
| `tools/edits/applySmartEngine.ts` | 334 | 🟢 Low | Medium |

---

## 🔴 CRITICAL PRIORITY: `backend/ws/server.ts` (2513 lines)

### The Problem

This file is a **monolithic WebSocket RPC server** that handles:
- WebSocket server setup and connection management
- 100+ RPC method handlers inline
- Terminal service creation
- Flow event broadcasting
- Session management
- Workspace operations
- Knowledge Base operations
- Provider operations
- Settings operations
- UI operations
- Kanban operations
- And more...

### Current Structure

```
server.ts (2513 lines)
├── Imports (1-44)
├── Helper functions (45-100)
├── Terminal service factory (100-273)
├── RPC method handlers (274-2240)
│   ├── Kanban RPCs (277-370)
│   ├── Flow RPCs (374-583)
│   ├── Session RPCs (601-900)
│   ├── Knowledge Base RPCs (901-1100)
│   ├── Flow Editor RPCs (1113-1400)
│   ├── Provider RPCs (1473-1600)
│   ├── Settings RPCs (1601-1700)
│   ├── Workspace RPCs (1701-2240)
│   └── Many more...
├── WebSocket server setup (1645-2245)
└── Server lifecycle (2246-2513)
```

### Refactoring Strategy

**Extract RPC handlers into domain-specific modules:**

```
electron/backend/ws/
├── server.ts (core server setup, ~300 lines)
├── broadcast.ts (existing)
├── snapshot.ts (existing)
├── service-handlers.ts (existing - sessions, kanban, providers, settings, flows)
├── handlers/
│   ├── terminal-handlers.ts (terminal RPCs)
│   ├── workspace-handlers.ts (workspace RPCs)
│   ├── kb-handlers.ts (knowledge base RPCs)
│   ├── flow-editor-handlers.ts (flow editor RPCs)
│   ├── ui-handlers.ts (UI state RPCs)
│   └── index.ts (exports all handlers)
└── terminal-service.ts (terminal service factory)
```

**Benefits:**
- ✅ Reduce server.ts from 2513 → ~300 lines (88% reduction)
- ✅ Clear separation of concerns
- ✅ Easier to test individual handler groups
- ✅ Better code organization
- ✅ Follows existing pattern (service-handlers.ts)

**Estimated Effort**: 3-4 hours  
**Risk**: Medium (requires careful extraction, but handlers are mostly independent)

---

## 🟠 HIGH PRIORITY: `ipc/edits.ts` (490 lines)

### The Problem

Legacy IPC handlers for edit operations that are **mostly unused** since migration to WebSocket RPC.

### Analysis Needed

- Check if any IPC handlers are still used
- Most edit operations now go through WebSocket RPC tools
- Likely candidate for deletion or consolidation

**Estimated Effort**: 1 hour  
**Risk**: Low (can verify usage easily)

---

## 🟠 HIGH PRIORITY: `tools/astGrep.ts` (409 lines)

### The Problem

Handles multiple responsibilities:
- Language registration (lines 1-100)
- AST-grep search (lines 102-273)
- AST-grep rewrite (lines 275-409)

### Refactoring Strategy

```
electron/tools/astGrep/
├── index.ts (exports)
├── languages.ts (language registration)
├── search.ts (search functionality)
└── rewrite.ts (rewrite functionality)
```

**Estimated Effort**: 1-2 hours  
**Risk**: Low (clear separation of concerns)

---

## 🟡 MEDIUM PRIORITY: `tools/workspace/searchWorkspace.ts` (912 lines)

### The Problem

Unified search tool that combines:
- Literal search (grep)
- Semantic search (embeddings)
- AST-grep integration
- Result merging and ranking
- Handle expansion
- NL-to-AST pattern conversion

### Current State

This is actually **well-designed** - it's the unified entrypoint for workspace search as per the architecture.

### Recommendation

**Keep as-is** - This file is intentionally comprehensive as the single entrypoint for all workspace search.

The size is justified by the complexity of the feature.

---

## Summary of Recommendations

### Immediate Actions (High ROI)

1. **Extract `backend/ws/server.ts` handlers** (🔴 CRITICAL)
   - Reduce from 2513 → ~300 lines
   - Extract into domain-specific handler modules
   - Follow existing `service-handlers.ts` pattern

2. **Audit `ipc/edits.ts`** (🟠 HIGH)
   - Check for unused IPC handlers
   - Delete or consolidate with WebSocket RPC

3. **Split `tools/astGrep.ts`** (🟠 HIGH)
   - Extract into languages/search/rewrite modules
   - Clear separation of concerns

### Lower Priority

- Services are generally well-sized and focused
- Flow engine files are complex but appropriately scoped
- Tools are mostly well-organized

---

## ✅ Implementation Complete!

### What Was Done

**Extracted `backend/ws/server.ts` handlers into domain-specific modules:**

Created 6 new handler modules in `electron/backend/ws/handlers/`:
1. **`terminal-handlers.ts` (209 lines)** - Terminal PTY, agent PTY, terminal tab management
2. **`workspace-handlers.ts` (158 lines)** - Workspace operations, folder management, settings
3. **`kb-handlers.ts` (95 lines)** - Knowledge Base CRUD, search, file indexing
4. **`ui-handlers.ts` (224 lines)** - View management, explorer, editor, window controls, UI state
5. **`flow-editor-handlers.ts` (188 lines)** - Flow templates, graph management, profiles, import/export
6. **`misc-handlers.ts` (233 lines)** - Tool results, edits preview, session metrics, indexing, handshake
7. **`index.ts` (12 lines)** - Exports all handler modules
8. **`types.ts` (7 lines)** - RpcConnection interface

### Results

- ✅ **Reduced `server.ts` from 2513 → 989 lines (61% reduction!)**
- ✅ **Removed 1524 lines of inline RPC handlers**
- ✅ **Clear separation of concerns by domain**
- ✅ **Easier to test individual handler groups**
- ✅ **Better code organization**
- ✅ **Follows existing `service-handlers.ts` pattern**
- ✅ **Zero compilation errors**

### File Structure

```
electron/backend/ws/
├── server.ts (989 lines, down from 2513)
├── broadcast.ts (existing)
├── snapshot.ts (existing)
├── service-handlers.ts (existing - sessions, kanban, providers, settings, flows)
├── types.ts (NEW - RpcConnection interface)
└── handlers/
    ├── index.ts (NEW - exports all handlers)
    ├── terminal-handlers.ts (NEW - 209 lines)
    ├── workspace-handlers.ts (NEW - 158 lines)
    ├── kb-handlers.ts (NEW - 95 lines)
    ├── ui-handlers.ts (NEW - 224 lines)
    ├── flow-editor-handlers.ts (NEW - 188 lines)
    └── misc-handlers.ts (NEW - 233 lines)
```

### Handler Registration

All handlers are registered in `server.ts` at connection time:

```typescript
// Register all RPC handlers
createTerminalHandlers(addMethod, connection)
createWorkspaceHandlers(addMethod, connection)
createKbHandlers(addMethod)
createUiHandlers(addMethod, connection)
createFlowEditorHandlers(addMethod)
createMiscHandlers(addMethod, connection)
```

## Next Steps

1. ✅ ~~Extract `backend/ws/server.ts` handlers~~ **COMPLETE**
2. ✅ ~~Audit `ipc/edits.ts` for unused IPC handlers~~ **COMPLETE**
3. ✅ ~~Remove all unused IPC handler files~~ **COMPLETE** (6 files, 761 lines removed)
4. Consider extracting remaining inline handlers from `service-handlers.ts` if needed
5. Split `tools/astGrep.ts` into languages/search/rewrite modules
6. Audit `electron/ipc/refactoring.ts` for actual usage


