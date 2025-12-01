# SessionTimelineService Method Ownership Analysis

**Date**: 2025-11-27  
**Question**: Do the 3 remaining methods belong in SessionTimelineService, or should they be moved elsewhere?

## Current Methods

### 1. `updateCurrentContext(params)` - Update session context

**Current location**: `SessionTimelineService`  
**What it does**: Updates `session.currentContext` fields (provider, model, messageHistory, etc)

**Called by**:
- `scheduler.ts:184` - Flush messageHistory back to session after flow execution
- `ProviderService.ts:135` - Update session when model changes
- `ProviderService.ts:168` - Update session when provider changes

**Analysis**: ❌ **WRONG SERVICE!**
- This method modifies `Session.currentContext`, not timeline items
- It's session CRUD, not timeline management
- **Should belong in**: `SessionService` (which manages session CRUD)

---

### 2. `startNewContext()` - Clear timeline and reset message history

**Current location**: `SessionTimelineService`  
**What it does**: Clears `session.timeline` and resets `session.currentContext.messageHistory`

**Called by**:
- `service-handlers.ts:99` - RPC handler for "New Context" button

**Analysis**: ⚠️ **PARTIALLY WRONG SERVICE**
- Clears timeline ✅ (timeline management - belongs here)
- Resets messageHistory ❌ (session context - belongs in SessionService)
- **Should be split**: Timeline clearing in SessionTimelineService, context reset in SessionService

---

### 3. `startListeningToFlow(requestId, args)` - Event-driven timeline management

**Current location**: `SessionTimelineService`  
**What it does**: Subscribes to flow events and creates/updates timeline items (node execution boxes, badges, etc)

**Called by**:
- `flow-engine/index.ts:36` - Start timeline listening when flow execution begins

**Analysis**: ✅ **CORRECT SERVICE!**
- This is pure timeline management
- Creates node execution boxes, manages badges, handles streaming
- **Should stay in**: `SessionTimelineService`

---

## Recommendations

### Option A: Move Methods to SessionService (Recommended)

**Move `updateCurrentContext` to SessionService:**
```typescript
// SessionService.ts
updateCurrentContext(params: {
  provider?: string
  model?: string
  systemInstructions?: string
  temperature?: number
  messageHistory?: Array<...>
}): void {
  const ws = this.getWorkspaceRoot()
  if (!ws) return
  
  const session = this.getCurrentSession()
  if (!session) return
  
  const sessions = this.getSessionsFor({ workspaceId: ws })
  const updated = sessions.map(s =>
    s.id === session.id
      ? {
          ...s,
          currentContext: { ...s.currentContext, ...params },
          updatedAt: Date.now(),
        }
      : s
  )
  
  this.setSessionsFor({ workspaceId: ws, sessions: updated })
  this.saveCurrentSession()
}
```

**Split `startNewContext` into two methods:**
```typescript
// SessionService.ts
resetCurrentContext(): void {
  // Reset messageHistory and generate new contextId
  const ws = this.getWorkspaceRoot()
  if (!ws) return
  
  const session = this.getCurrentSession()
  if (!session) return
  
  const sessions = this.getSessionsFor({ workspaceId: ws })
  const updated = sessions.map(s =>
    s.id === session.id
      ? {
          ...s,
          currentContext: {
            ...s.currentContext,
            contextId: crypto.randomUUID(),
            messageHistory: [],
          },
          updatedAt: Date.now(),
        }
      : s
  )
  
  this.setSessionsFor({ workspaceId: ws, sessions: updated })
  await this.saveCurrentSession(true)
}

// SessionTimelineService.ts
clearTimeline(): void {
  // Clear timeline items only
  const sessionService = ServiceRegistry.get<any>('session')
  const ws = sessionService?.getWorkspaceRoot()
  if (!ws) return
  
  const session = sessionService.getCurrentSession()
  if (!session) return
  
  const sessions = sessionService.getSessionsFor({ workspaceId: ws })
  const updated = sessions.map(s =>
    s.id === session.id
      ? { ...s, timeline: [], updatedAt: Date.now() }
      : s
  )
  
  sessionService.setSessionsFor({ workspaceId: ws, sessions: updated })
  await sessionService.saveCurrentSession(true)
}

// service-handlers.ts
async startNewContext() {
  const sessionService = getSessionService()
  const timelineService = getSessionTimelineService()
  
  await sessionService.resetCurrentContext()
  await timelineService.clearTimeline()
  
  return { ok: true }
}
```

**Benefits**:
- ✅ Clear separation of concerns (session CRUD vs timeline management)
- ✅ SessionService owns all `session.currentContext` modifications
- ✅ SessionTimelineService only manages `session.timeline`
- ✅ Better testability (each service has focused responsibility)

---

### Option B: Eliminate SessionTimelineService Entirely (Radical)

**Observation**: After moving methods, SessionTimelineService would have only ONE method: `startListeningToFlow`

**Could we**:
1. Move `startListeningToFlow` to `flow-engine/timeline-listener.ts` as a standalone function?
2. Delete SessionTimelineService entirely?

**Example**:
```typescript
// flow-engine/timeline-listener.ts
export function startListeningToFlow(requestId: string, args: FlowExecutionArgs): () => void {
  // All the event handling logic (same as current implementation)
  // ...
}

// flow-engine/index.ts
import { startListeningToFlow } from './timeline-listener.js'

export async function executeFlow(wc, args) {
  const persistUnsubscribe = startListeningToFlow(args.requestId, args)
  persistSubs.set(args.requestId, persistUnsubscribe)
  // ...
}
```

**Benefits**:
- ✅ One less service to maintain
- ✅ Timeline listening is co-located with flow execution
- ✅ No service registry lookup needed
- ✅ Clearer that it's a flow-engine concern, not a session concern

**Drawbacks**:
- ⚠️ Breaks service pattern (but is that bad if it's not really a service?)

---

## Recommendation

**Phase 1** (Immediate): Move `updateCurrentContext` to SessionService
- Clear win - it's session CRUD, not timeline management
- Update 3 call sites (scheduler, ProviderService x2)

**Phase 2** (Optional): Split `startNewContext` into two methods
- `SessionService.resetCurrentContext()` - Reset context
- `SessionTimelineService.clearTimeline()` - Clear timeline
- Update 1 call site (service-handlers)

**Phase 3** (Future): Consider eliminating SessionTimelineService
- Move `startListeningToFlow` to `flow-engine/timeline-listener.ts`
- Delete SessionTimelineService
- Simplify architecture

## Summary

**Current state**: SessionTimelineService has 3 methods, but only 1 truly belongs there!

| Method | Current Service | Should Be In | Reason |
|--------|----------------|--------------|--------|
| `updateCurrentContext` | SessionTimelineService | SessionService | Session CRUD |
| `startNewContext` | SessionTimelineService | Split between both | Mixed concerns |
| `startListeningToFlow` | SessionTimelineService | ✅ Correct (or flow-engine) | Timeline management |

**Impact**: Moving methods would leave SessionTimelineService with only 1 method, making it a candidate for elimination.

---

## ✅ IMPLEMENTATION COMPLETE

**Date**: 2025-11-27

### Changes Made

**1. Moved `updateCurrentContext` to SessionService** ✅
- Added method to `SessionService.ts` (lines 293-330)
- Updated call sites:
  - `scheduler.ts:178` - Changed from `getSessionTimelineService()` to `getSessionService()`
  - `ProviderService.ts:135, 168` - Already calling `sessionService.updateCurrentContext()` ✅
- Removed method from `SessionTimelineService.ts`

**2. Moved `startNewContext` to SessionService** ✅
- Added `resetCurrentContext()` method to `SessionService.ts` (lines 335-372)
- Updated call site:
  - `service-handlers.ts:97` - Changed from `sessionTimelineService.startNewContext()` to `sessionService.resetCurrentContext()`
- Removed method from `SessionTimelineService.ts`

**3. Kept `startListeningToFlow` in SessionTimelineService** ✅
- This is the only method that truly belongs in SessionTimelineService
- It's a massive 964-line method that handles all flow event listening
- Extracting to standalone file would be risky and provide minimal benefit

**4. Cleanup** ✅
- Removed unused `getSessionContext()` helper from SessionTimelineService
- Removed `getSessionTimelineService` import from `service-handlers.ts`
- Updated header comment to reflect new architecture

### Results

| File | Before | After | Change |
|------|--------|-------|--------|
| **SessionTimelineService.ts** | 1,242 lines | 1,160 lines | **-82 lines (-6.6%)** |
| **SessionService.ts** | 714 lines | 787 lines | **+73 lines (+10.2%)** |
| **Net change** | - | - | **-9 lines** |

**Public Methods**:
- SessionTimelineService: 3 → 1 method (**-67% reduction**)
- SessionService: Added 2 new methods for session context management

### Architecture Improvements

**Before**:
- ❌ SessionTimelineService had mixed concerns (timeline + session context)
- ❌ ProviderService was calling wrong service (`sessionService.updateCurrentContext()` didn't exist)
- ❌ Unclear separation of responsibilities

**After**:
- ✅ SessionService owns ALL session context management (provider, model, messageHistory)
- ✅ SessionTimelineService focused ONLY on timeline event handling
- ✅ Clear separation of concerns
- ✅ Better testability (each service has focused responsibility)

### Total Cleanup Progress

| Phase | Files | Lines | Description |
|-------|-------|-------|-------------|
| IPC Edits | 1 | 134 | Removed IPC handlers |
| IPC Mass | 6 | 761 | Removed unused IPC |
| IPC Refactoring | 3 | 527 | Removed TS refactoring |
| AST-grep | 5 | 1,142 | Removed all ast-grep |
| SessionTimeline Boilerplate | 0 | 58 | Eliminated boilerplate |
| SessionTimeline Dead Code | 0 | 248 | Removed dead methods |
| SessionTimeline Architecture | 0 | 160 | Removed state/buffers |
| **Method Ownership** | **0** | **9** | **Moved methods to correct service** |
| **TOTAL** | **15** | **3,039** | **Complete cleanup!** |

**The codebase is now 3,039 lines lighter with significantly better architecture!** 🚀

