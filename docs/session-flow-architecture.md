# Session-Flow Architecture

## Overview

This document describes the architectural relationship between Sessions and Flows in the application.

## Core Principles

1. **Sessions are the persistent unit of work** - They capture all user interactions, chat history, and remember state across app restarts
2. **Flows are tools used within sessions** - They execute logic but don't persist state themselves
3. **Event handlers are global and always active** - They handle flow events regardless of which view is active
4. **Flows can run in the background** - User can switch views while flow executes

## Data Model

### Session Type
```typescript
export type Session = {
  id: string
  title: string
  messages: ChatMessage[]  // All user/assistant interactions
  createdAt: number
  updatedAt: number
  
  // Flow integration
  lastUsedFlow?: string  // Flow template ID (e.g., 'default', 'user/my-flow')
  flowState?: {
    requestId: string      // Current flow execution requestId
    pausedAt: number       // Timestamp when flow was paused
    pausedNodeId?: string  // Which node the flow is paused at
  }
  
  // Token tracking
  tokenUsage: { byProvider: Record<string, TokenUsage>; total: TokenUsage }
  costs: { byProviderAndModel: Record<string, Record<string, TokenCost>>; totalCost: number; currency: string }
  
  // Provider-specific state (optional)
  conversationState?: Record<string, { conversationId?: string; ... }>
}
```

## Application Lifecycle

### 1. App Initialization (`initializeStore`)
```
1. Load workspace settings
2. Load API keys and providers
3. Register global flow event handlers (ONCE, always active)
4. Load/create current session
5. Initialize session (loads flow, restores state)
```

### 2. Session Initialization
```
When session loads:
1. Restore chat history to UI (session.messages)
2. Load flow template (session.lastUsedFlow or default)
3. If session.flowState exists:
   - Resume paused flow with saved requestId
   - Restore paused state
4. Else:
   - Initialize new flow execution
   - Run until first userInput node
   - Save flowState when paused
```

### 3. Flow Event Handling (Global)
```
Event handlers registered at app startup:
- Listen to 'flow:event' IPC channel
- Handle ALL events regardless of view
- Update session state:
  * Add messages to session.messages
  * Update session.lastUsedFlow
  * Save session.flowState when paused
  * Clear session.flowState when done
- Update UI state:
  * feRunning, fePaused, feStreamingText
  * feEvents (for debug panel)
- Update streaming state for real-time display
```

### 4. Flow Lifecycle
```
Flow initialization:
- Only happens when:
  1. Session loads and no flowState exists
  2. User explicitly loads a new flow template
  
Flow execution:
- Auto-runs until first userInput node
- Pauses and waits for user input
- User sends message → resume → execute → pause at next userInput
- Can run in background while user is on different view

Flow completion:
- Clear session.flowState
- Mark flow as done
- Ready for next interaction
```

## Implementation Plan

### Phase 1: Move Event Handlers to App Level
**File**: `src/store/index.ts` or `src/store/slices/flowEditor.slice.ts`

- Remove event listener registration from `initFlowEditor`
- Add global event listener registration in `initializeStore`
- Event handler updates:
  * Session state (messages, lastUsedFlow, flowState)
  * UI state (feRunning, fePaused, feStreamingText, feEvents)
  * Streaming state for real-time display

### Phase 2: Update Session Initialization
**File**: `src/store/slices/session.slice.ts`

- Add `initializeSession` action
- When session loads:
  * Restore chat history
  * Load lastUsedFlow template
  * If flowState exists, resume flow
  * Else, initialize new flow

### Phase 3: Update Flow Initialization
**File**: `src/store/slices/flowEditor.slice.ts`

- Remove duplicate initialization from ChatPane
- `feInit` should only be called from:
  * Session initialization (when no flowState)
  * User explicitly loading new template
- Add `feResumeFromState` for resuming paused flows

### Phase 4: Session-Flow Integration
**Files**: Event handlers, session slice

- When flow events occur:
  * `nodeEnd` on chat node → add assistant message to session
  * `waitingForInput` → save flowState to session
  * `done` → clear flowState from session
  * Update session.lastUsedFlow when flow loads
- Auto-save session after state changes

### Phase 5: Clean Up
- Remove old initialization code
- Remove duplicate event subscriptions
- Ensure no race conditions
- Test session persistence and resumption

## Event Flow Diagram

```
App Start
  ↓
initializeStore()
  ↓
Register Global Flow Event Handlers (ONCE)
  ↓
Load/Create Session
  ↓
initializeSession()
  ├─ Restore chat history
  ├─ Load lastUsedFlow template
  └─ If flowState exists:
      └─ Resume flow
     Else:
      └─ Initialize flow → Run until pause
  ↓
Flow Events (handled globally)
  ├─ chunk → Update feStreamingText
  ├─ nodeEnd (chat) → Add message to session
  ├─ waitingForInput → Save flowState to session
  └─ done → Clear flowState from session
  ↓
User Interaction
  ├─ Send message → feResume() → Flow continues
  ├─ Switch view → Flow keeps running
  └─ Close app → Session saved with flowState
  ↓
App Restart
  └─ Load session → Resume from flowState
```

## Benefits

1. **Persistent State** - Sessions remember everything across app restarts
2. **Background Execution** - Flows can run while user is on different view
3. **Single Source of Truth** - Session is the authoritative source for all interactions
4. **Clean Separation** - Sessions (persistent) vs Flows (ephemeral execution)
5. **No Duplicate Subscriptions** - Event handlers registered once at app level
6. **Predictable Lifecycle** - Clear initialization and cleanup paths

## Migration Notes

- Existing sessions will need migration to add `lastUsedFlow` and `flowState` fields
- Default to 'default' flow template if not specified
- Gracefully handle missing flowState (just initialize new flow)

