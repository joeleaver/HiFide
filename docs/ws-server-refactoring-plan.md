# WebSocket Server Refactoring Plan

## Executive Summary

**Current**: 997-line monolith with duplicate code, scattered concerns, and no testability
**Target**: Clean, modular architecture with <200 line server.ts and proper separation of concerns

## Current State Analysis

**File**: `electron/backend/ws/server.ts` (997 lines)

### Current Architecture (PROBLEMATIC)

```
┌─────────────────────────────────────────────────────────────┐
│                      server.ts (997 lines)                   │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ HTTP Server + WebSocket Server + Auth + Bootstrap  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Connection Handler (816 lines!)                     │    │
│  │  • Auth check                                       │    │
│  │  • RPC setup                                        │    │
│  │  • Connection registration                          │    │
│  │  • Workspace binding (4 different places!)          │    │
│  │  • Inline RPC handlers (300+ lines)                 │    │
│  │  • Handler module registration (6 modules)          │    │
│  │  • Event listener setup (8 services × 50 lines)     │    │
│  │  • Cleanup on close                                 │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Global Flow Event Forwarder                         │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Module-level State (anti-pattern)                   │    │
│  │  • httpServer, wss, bootstrap, promises             │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Proposed Architecture (CLEAN)

```
┌──────────────────────────────────────────────────────────────┐
│                   server.ts (150 lines)                       │
│  • Start/stop HTTP + WebSocket servers                       │
│  • Bootstrap token generation                                │
│  • Delegate to ConnectionManager                             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              ConnectionManager (200 lines)                    │
│  • Handle new connections                                     │
│  • Setup authentication                                       │
│  • Delegate to RpcRouter                                      │
│  • Delegate to EventSubscriptionManager                       │
│  • Handle cleanup                                             │
└──────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│   RpcRouter     │  │ EventSubscription│  │ WorkspaceBinding │
│   (150 lines)   │  │ Manager          │  │ Service          │
│                 │  │ (200 lines)      │  │ (150 lines)      │
│ • Route methods │  │                  │  │                  │
│ • Load handlers │  │ • Subscribe to   │  │ • Bind workspace │
│ • Middleware    │  │   service events │  │ • Check existing │
│                 │  │ • Filter by      │  │ • Focus window   │
│                 │  │   workspace      │  │ • Send snapshot  │
└─────────────────┘  └─────────────────┘  └──────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│                    handlers/ (modular)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │   session    │ │  handshake   │ │  workspace   │         │
│  │   handlers   │ │   handlers   │ │  hydration   │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │   terminal   │ │      kb      │ │      ui      │         │
│  │   handlers   │ │   handlers   │ │   handlers   │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐                          │
│  │ flow-editor  │ │     misc     │                          │
│  │   handlers   │ │   handlers   │                          │
│  └──────────────┘ └──────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### Major Architectural Issues

#### 1. **Violation of Single Responsibility Principle**
The server.ts file is doing WAY too much:
- WebSocket server lifecycle management
- HTTP server setup
- Authentication/authorization
- Connection management
- RPC method registration (still ~300 lines inline)
- Event listener setup for 8+ services
- Flow event broadcasting
- Workspace binding logic
- Handshake protocol
- Session hydration
- Multiple duplicate RPC handlers (workspace.get, workspace.hydrate, workspace.hydrateStrict, workspace.hydrateStrict again!)

#### 2. **Poor Separation of Concerns**
- **Connection lifecycle** mixed with **business logic**
- **Authentication** mixed with **RPC routing**
- **Event subscription** mixed with **connection setup**
- **Workspace binding** logic scattered across multiple places (lines 127-143, 227-247, 398-424, 497-614)

#### 3. **Code Duplication**
- `workspace.hydrate` appears at line 617
- `workspace.hydrateStrict` appears at line 472 AND line 645 (duplicate!)
- `workspace.get` logic duplicated in multiple places
- Workspace binding logic repeated 4+ times
- Connection workspace checking pattern repeated in every event listener

#### 4. **Tight Coupling**
- Direct service imports and calls throughout
- Event listeners directly coupled to connection object
- No abstraction layer between RPC and services
- Flow events hardcoded to broadcast function

#### 5. **Inconsistent Error Handling**
- Mix of try-catch with empty catch blocks
- Some methods return `{ ok: false, error }`, others throw
- Silent failures everywhere (`catch { }`)

#### 6. **State Management Issues**
- Module-level state (httpServer, wss, bootstrap)
- Connection metadata in separate broadcast.ts
- No clear ownership of connection lifecycle

#### 7. **Testing Nightmare**
- Impossible to unit test individual handlers
- Can't mock services without mocking entire module
- Event listeners can't be tested in isolation
- No dependency injection

## Proposed Architecture

### Phase 1: Extract Remaining Inline Handlers (IMMEDIATE)

**Goal**: Move all inline RPC handlers to dedicated modules

**Files to create/modify**:
1. `handlers/session-handlers.ts` - Session operations (list, select, new, usage, metrics)
2. `handlers/handshake-handlers.ts` - Handshake protocol, workspace binding
3. `handlers/workspace-hydration-handlers.ts` - All hydration methods (consolidate duplicates!)

**Duplicates to eliminate**:
- Merge two `workspace.hydrateStrict` implementations (lines 472 & 645)
- Consolidate workspace binding logic into single function
- Unify workspace checking pattern for event listeners

### Phase 2: Connection Lifecycle Management

**Goal**: Separate connection management from business logic

**New file**: `connection-manager.ts`
```typescript
class ConnectionManager {
  - registerConnection()
  - setupAuthentication()
  - setupRpcHandlers()
  - setupEventListeners()
  - cleanupConnection()
  - getConnectionMeta()
}
```

### Phase 3: Event Subscription Service

**Goal**: Decouple event listeners from connection setup

**New file**: `event-subscriptions.ts`
```typescript
class EventSubscriptionManager {
  - subscribeToServiceEvents(connection, workspaceId)
  - unsubscribeAll(connection)
  - createWorkspaceFilter(workspaceId)
}
```

**Benefits**:
- Single place for all event → notification mapping
- Reusable workspace filtering logic
- Easy to add/remove event subscriptions
- Testable in isolation

### Phase 4: Workspace Binding Service

**Goal**: Centralize all workspace binding logic

**New file**: `workspace-binding.ts`
```typescript
class WorkspaceBindingService {
  - bindConnectionToWorkspace(connection, workspaceId)
  - handleWorkspaceOpen(connection, root)
  - handleWorkspaceAttach(connection)
  - isWorkspaceAlreadyOpen(workspaceId)
  - focusExistingWorkspace(workspaceId)
}
```

### Phase 5: RPC Router

**Goal**: Clean separation between routing and handlers

**New file**: `rpc-router.ts`
```typescript
class RpcRouter {
  - registerHandlers(addMethod)
  - route(method, params)
  - middleware: [auth, logging, errorHandling]
}
```

## File Structure (Target)

```
electron/backend/ws/
├── server.ts (150 lines - ONLY server lifecycle)
├── connection-manager.ts (NEW - connection lifecycle)
├── rpc-router.ts (NEW - routing logic)
├── event-subscriptions.ts (NEW - event → notification)
├── workspace-binding.ts (NEW - workspace binding)
├── broadcast.ts (existing - connection registry)
├── snapshot.ts (existing - snapshot builder)
├── service-handlers.ts (existing - service facades)
└── handlers/
    ├── index.ts
    ├── session-handlers.ts (NEW - session ops)
    ├── handshake-handlers.ts (NEW - handshake)
    ├── workspace-hydration-handlers.ts (NEW - hydration)
    ├── terminal-handlers.ts (existing)
    ├── workspace-handlers.ts (existing)
    ├── kb-handlers.ts (existing)
    ├── ui-handlers.ts (existing)
    ├── flow-editor-handlers.ts (existing)
    └── misc-handlers.ts (existing)
```

## Success Metrics

- [ ] server.ts under 200 lines
- [ ] No duplicate RPC method definitions
- [ ] All handlers in dedicated modules
- [ ] Event subscriptions in single location
- [ ] Workspace binding logic centralized
- [ ] Unit tests for each handler module
- [ ] Integration tests for connection lifecycle
- [ ] Zero silent failures (proper error handling)

## Specific Code Smells Identified

### 1. Duplicate Method Definitions
**Lines 472-493**: `workspace.hydrateStrict` (first definition)
**Lines 645-685**: `workspace.hydrateStrict` (DUPLICATE - second definition!)

These are nearly identical with minor differences. Need to consolidate.

### 2. Workspace Binding Scattered Everywhere
- **Lines 127-143**: Global workspace:changed listener
- **Lines 227-247**: Initial binding on connection
- **Lines 398-424**: handshake.init binding logic
- **Lines 497-614**: workspace.open binding logic

All doing similar things with slight variations. Should be ONE function.

### 3. Event Listener Boilerplate (Repeated 8+ times)
Pattern repeated for every service:
```typescript
const serviceListener = (data: any) => {
  try {
    const bound = getConnectionWorkspaceId(connection)
    const workspaceService = getWorkspaceService()
    const curRoot = workspaceService.getWorkspaceRoot() || null
    if (bound && curRoot && bound !== curRoot) return
    // ... actual logic
  } catch { }
}
service.on('event', serviceListener)
```

This workspace filtering logic is copy-pasted 8 times! (lines 722-738, 744-759, 765-778, 781-793, 797-812, 816-830, 834-847, 857-877)

### 4. Silent Failures Everywhere
Over 50 instances of `catch { }` with no logging or error handling.
Examples:
- Line 64: Flow event broadcast failure
- Line 89: Flow event serialization failure
- Line 111: Workspace notification failure
- And many more...

### 5. Inconsistent Return Types
Some handlers return:
- `{ ok: true, data }` / `{ ok: false, error }`
- `{ sessionId }` (no ok field)
- `{ pong: true }` (different structure)
- Direct values

No consistent API contract.

### 6. Mixed Concerns in Single Function
**Lines 146-962**: The `wss.on('connection')` callback is 816 lines!
It handles:
- Authentication
- RPC server setup
- Connection registration
- Workspace binding
- Method registration (calling 6 handler creators)
- Event listener setup (8 services)
- Cleanup on close

This should be 10+ separate functions.

### 7. Global State Anti-Pattern
**Lines 48-52**: Module-level mutable state
```typescript
let httpServer: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null
let bootstrap: WsBootstrap | null = null
let bootstrapReady: Promise<WsBootstrap> | null = null
let resolveBootstrap: ((value: WsBootstrap) => void) | null = null
```

Makes testing impossible and creates hidden dependencies.

### 8. Tight Service Coupling
**Lines 36-45**: Direct imports of 9 services
Every handler directly calls services. No abstraction layer, no dependency injection, no mocking possible.

## Refactoring Strategy

### Quick Wins (Can do TODAY)
1. ✅ Extract session handlers (lines 357-394)
2. ✅ Extract handshake handlers (lines 398-470)
3. ✅ Extract workspace hydration handlers (lines 472-685) - CONSOLIDATE DUPLICATES
4. ✅ Create workspace binding utility function
5. ✅ Create event subscription helper

### Medium Term (This Week)
1. Create ConnectionManager class
2. Create EventSubscriptionManager class
3. Create WorkspaceBindingService class
4. Add proper error handling with logging
5. Standardize return types

### Long Term (Next Sprint)
1. Add dependency injection
2. Add comprehensive unit tests
3. Add integration tests
4. Replace global state with proper lifecycle management
5. Add middleware pipeline for RPC

## Next Steps

1. **IMMEDIATE**: Extract remaining inline handlers (Phase 1)
2. Create ConnectionManager (Phase 2)
3. Create EventSubscriptionManager (Phase 3)
4. Create WorkspaceBindingService (Phase 4)
5. Add comprehensive tests
6. Add proper error handling and logging

