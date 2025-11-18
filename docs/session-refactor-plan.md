# Session & Chat System Refactor Plan

## Overview

This document outlines the comprehensive refactor of the session/chat system to address the following issues:
1. Chat history not being saved properly after the JSONRPC migration
2. Missing badge persistence (intent, tools, etc.)
3. Lack of session metadata (context, provider/model, flow state)
4. Inconsistent terminology (chat vs session)
5. No debouncing for session saves (excessive disk writes)

## Current State Analysis

### What Works
- ✅ Sessions are created and stored in `~/.hifide/sessions/`
- ✅ Basic message history (user/assistant) is captured
- ✅ Token usage and costs are tracked per session
- ✅ Flow state (lastUsedFlow, flowState) is partially tracked
- ✅ Badges are displayed in UI (intent, tools, cache hits)

### What's Broken
- ❌ **Session saving is broken**: Uses `window.sessions` which doesn't exist in the current JSONRPC architecture (no window APIs)
- ❌ **Badges not persisted**: Intent and tool badges are only in `currentTurnToolCalls` state, not saved to disk
- ❌ **No debouncing**: Every message triggers immediate save (excessive disk I/O)
- ❌ **Missing metadata**: No tracking of current context, provider/model per message
- ❌ **Terminology confusion**: UI mixes "chat" and "session" terminology

### Current Data Flow

```
User Input → feResume() → Flow Execution → LLM Response
                                ↓
                        Event Handlers (feHandleChunk, feHandleToolStart, etc.)
                                ↓
                        Update State (currentTurnToolCalls, currentTurnIntent)
                                ↓
                        addAssistantMessage() → Attach badges to message
                                ↓
                        saveCurrentSession() → window.sessions.save() [BROKEN]
```

### New Data Flow (Inline Badges)

```
User Input → feResume() → Flow Execution
                                ↓
                        Tool Start → addSessionItem({ type: 'badge', badge: {...} })
                                ↓
                        Tool End → updateSessionItem(badgeId, { status: 'success' })
                                ↓
                        LLM Chunk → addSessionItem({ type: 'message', role: 'assistant', content: chunk })
                                ↓
                        Tool Start → addSessionItem({ type: 'badge', badge: {...} })
                                ↓
                        LLM Chunk → appendToLastMessage(chunk)
                                ↓
                        saveCurrentSession() [DEBOUNCED]
```

**Key Insight**: Session items are a chronological stream of messages and badges, not messages with attached badges.

## Architecture Goals

### 1. Single Source of Truth
- All session data lives in the Zustand store (main process)
- Sessions are persisted to `~/.hifide/sessions/{sessionId}.json`
- No `window.*` APIs - everything goes through the store

### 2. Rich Session Metadata
Each session should track:
- **Messages**: Full conversation history with badges
- **Context**: Current "main" context (provider, model, system instructions)
- **Flow State**: Current flow, execution state, paused nodes
- **Costs**: Token usage and costs per provider/model
- **Badges**: All badges (intent, tools, file edits, etc.) grouped by message
- **Timestamps**: Created, updated, last activity

### 3. Badge System
Badges should be:
- **Persistent**: Saved to disk with messages
- **Grouped**: Visually grouped with the node/message that created them
- **Interactive**: Support for future interactive badges (diffs, etc.)
- **Chronological**: Ordered by timestamp within each group

### 4. Debounced Saving
- Immediate save for critical events (new session, session switch)
- Debounced save (500ms) for frequent updates (messages, badges, metadata)
- Atomic writes to prevent corruption

## Implementation Plan

### Phase 1: Type System Refactor

**File**: `electron/store/types.ts`

#### 1.1 Create Badge Types
```typescript
export type BadgeType = 
  | 'intent'      // Intent router classification
  | 'tool'        // Tool execution
  | 'cache'       // Cache hit
  | 'fileEdit'    // File edit (future: interactive diff)
  | 'error'       // Error badge
  | 'custom'      // Custom badge

export type Badge = {
  id: string                    // Unique ID for this badge
  type: BadgeType
  timestamp: number
  nodeId?: string               // Which flow node created this badge
  
  // Badge-specific data
  label: string                 // Display text
  icon?: string                 // Emoji or icon
  color?: string                // Badge color
  variant?: 'light' | 'filled'  // Badge style
  
  // Interactive badge data (future)
  interactive?: {
    type: 'diff' | 'link' | 'action'
    data: any
  }
  
  // Status (for tool badges)
  status?: 'running' | 'success' | 'error'
  error?: string
}

export type BadgeGroup = {
  id: string                    // Unique ID for this group
  nodeId?: string               // Which node created these badges
  nodeLabel?: string            // Display name of the node
  timestamp: number             // When this group was created
  badges: Badge[]               // Badges in this group
}
```

#### 1.2 Create SessionItem Type (Inline Timeline)
```typescript
// Session items represent the chronological timeline of a session
// This allows badges to appear inline with messages, not just grouped at the top/bottom

export type SessionItem =
  | SessionMessage
  | SessionBadgeGroup

export type SessionMessage = {
  type: 'message'
  id: string                    // Unique ID for this message
  role: 'user' | 'assistant'
  content: string
  timestamp: number

  // Metadata about this message
  provider?: string             // Which provider generated this
  model?: string                // Which model generated this
  tokenUsage?: TokenUsage       // Token usage for this message
}

export type SessionBadgeGroup = {
  type: 'badge-group'
  id: string                    // Unique ID for this badge group
  nodeId?: string               // Which node created these badges
  nodeLabel?: string            // Display name of the node
  timestamp: number
  badges: Badge[]               // Badges in this group
}

// Legacy ChatMessage type (for migration)
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  intent?: string
  tokenUsage?: TokenUsage
}
```

#### 1.3 Update Session Type
```typescript
export type Session = {
  id: string
  title: string
  items: SessionItem[]          // NEW: Chronological timeline of messages and badges
  createdAt: number
  updatedAt: number
  lastActivityAt: number        // NEW: Last user/assistant interaction

  // Current session context
  currentContext: {             // NEW: Main context metadata
    provider: string
    model: string
    systemInstructions?: string
    temperature?: number
  }

  // Flow state
  lastUsedFlow?: string
  flowState?: {
    requestId: string
    status: 'idle' | 'running' | 'paused' | 'error'
    pausedAt?: number
    pausedNodeId?: string
  }

  // Token usage and costs (existing)
  tokenUsage: {
    byProvider: Record<string, TokenUsage>
    total: TokenUsage
  }
  costs: {
    byProviderAndModel: Record<string, Record<string, TokenCost>>
    totalCost: number
    currency: string
  }

  // Provider-specific state (existing)
  conversationState?: Record<string, {
    conversationId?: string
    lastResponseId?: string
    preambleHash?: string
    lastSystemPrompt?: string
    lastToolsHash?: string
  }>

  // Legacy fields (for migration)
  messages?: ChatMessage[]      // DEPRECATED: Use items instead
  toolCalls?: ToolCall[]        // DEPRECATED: Use items instead
}
```

### Phase 2: Badge Infrastructure

**Files**: 
- `electron/store/slices/session.slice.ts`
- `src/components/BadgeGroup.tsx` (new)
- `src/components/ChatPane.tsx`

#### 2.1 Badge Actions in Session Slice
```typescript
export interface SessionSlice {
  // ... existing fields ...
  
  // Badge Actions
  addBadge: (params: { 
    badge: Omit<Badge, 'id' | 'timestamp'>
    nodeId?: string
    nodeLabel?: string
  }) => void
  
  updateBadge: (params: {
    badgeId: string
    updates: Partial<Badge>
  }) => void
  
  // Current turn badge groups (before message is added)
  currentTurnBadgeGroups: BadgeGroup[]
  clearCurrentTurnBadges: () => void
}
```

#### 2.2 Badge Group Component
Create `src/components/BadgeGroup.tsx` to render badge groups with:
- Node label header (if present)
- Badges in chronological order
- Support for interactive badges (future)
- Proper styling and icons

#### 2.3 Update ChatPane to Use Badge Groups
Replace current badge rendering with new `BadgeGroup` component.

### Phase 3: Session Metadata Enhancement

**File**: `electron/store/slices/session.slice.ts`

#### 3.1 Track Current Context
```typescript
// When provider/model changes, update session's currentContext
updateSessionContext: (params: {
  provider?: string
  model?: string
  systemInstructions?: string
  temperature?: number
}) => void
```

#### 3.2 Track Message Metadata
```typescript
// When adding assistant message, include provider/model
addAssistantMessage: (params: {
  content: string
  provider: string
  model: string
}) => void
```

#### 3.3 Update Flow State
```typescript
// Update flow state when flow starts/pauses/completes
updateFlowState: (params: {
  status: 'idle' | 'running' | 'paused' | 'error'
  requestId?: string
  pausedNodeId?: string
}) => void
```

### Phase 4: Debounced Session Saving

**File**: `electron/store/slices/session.slice.ts`

#### 4.1 Move Session Saving to Main Process
```typescript
// Remove window.sessions dependency
// Use direct file system operations in main process

import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'

async function getSessionsDir(): Promise<string> {
  const userDataPath = app.getPath('userData')
  const sessionsDir = path.join(userDataPath, 'sessions')
  await fs.mkdir(sessionsDir, { recursive: true })
  return sessionsDir
}

async function saveSessionToDisk(session: Session): Promise<void> {
  const sessionsDir = await getSessionsDir()
  const filePath = path.join(sessionsDir, `${session.id}.json`)
  
  // Atomic write
  const tempPath = `${filePath}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(session, null, 2), 'utf-8')
  await fs.rename(tempPath, filePath)
}
```

#### 4.2 Implement Debounced Save
```typescript
// Debounce helper (already exists in flowEditor.slice.ts)
let saveSessionTimeout: NodeJS.Timeout | null = null

function debouncedSaveSession(session: Session, immediate = false) {
  if (saveSessionTimeout) {
    clearTimeout(saveSessionTimeout)
  }
  
  if (immediate) {
    saveSessionToDisk(session)
  } else {
    saveSessionTimeout = setTimeout(() => {
      saveSessionToDisk(session)
      saveSessionTimeout = null
    }, 500) // 500ms debounce
  }
}
```

#### 4.3 Update Save Triggers
```typescript
// Immediate save for:
// - New session creation
// - Session switch
// - Session deletion
// - App shutdown

// Debounced save for:
// - New messages
// - Badge updates
// - Metadata updates
// - Token usage updates
```

### Phase 5: UI Refactor - Rename Chat to Session

**Files**:
- `src/components/AgentView.tsx`
- `src/components/ChatPane.tsx` → `src/components/SessionPane.tsx`
- `electron/store/slices/session.slice.ts`

#### 5.1 Rename Components
- `ChatPane` → `SessionPane`
- `chatInput` → `sessionInput`
- "New Chat" → "New Session"
- "Chat" dropdown → "Session" dropdown

#### 5.2 Update UI Labels
- Session selector: "Select session" (already correct)
- New button: "New Session"
- Session title: Default to "New Session" instead of "New Chat"

### Phase 6: Migration & Testing

#### 6.1 Create Migration Function
```typescript
// Migrate old sessions to new format
async function migrateSession(oldSession: any): Promise<Session> {
  return {
    ...oldSession,
    lastActivityAt: oldSession.updatedAt,
    currentContext: {
      provider: 'openai', // Default
      model: 'gpt-4o',    // Default
    },
    flowState: oldSession.flowState ? {
      ...oldSession.flowState,
      status: 'idle'
    } : undefined,
    messages: oldSession.messages.map((msg: any) => ({
      ...msg,
      timestamp: msg.timestamp || Date.now(),
      badgeGroups: migrateBadges(msg),
    }))
  }
}

function migrateBadges(msg: any): BadgeGroup[] | undefined {
  const groups: BadgeGroup[] = []
  
  // Migrate intent
  if (msg.intent) {
    groups.push({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      badges: [{
        id: crypto.randomUUID(),
        type: 'intent',
        timestamp: Date.now(),
        label: msg.intent,
        icon: '🎯',
        color: 'orange',
        variant: 'light'
      }]
    })
  }
  
  // Migrate tool calls
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    groups.push({
      id: crypto.randomUUID(),
      timestamp: msg.toolCalls[0].timestamp,
      badges: msg.toolCalls.map((tc: any) => ({
        id: crypto.randomUUID(),
        type: 'tool',
        timestamp: tc.timestamp,
        label: tc.toolName,
        icon: '🔧',
        color: tc.status === 'error' ? 'red' : 'green',
        variant: 'light',
        status: tc.status,
        error: tc.error
      }))
    })
  }
  
  return groups.length > 0 ? groups : undefined
}
```

#### 6.2 Testing Checklist
- [ ] Create new session
- [ ] Send messages
- [ ] Verify badges appear and persist
- [ ] Switch sessions
- [ ] Reload app - verify session restored
- [ ] Test debouncing (no excessive saves)
- [ ] Test migration of old sessions
- [ ] Test session deletion
- [ ] Test flow state persistence
- [ ] Test provider/model tracking

## Implementation Order

1. **Phase 1**: Type system refactor (foundation)
2. **Phase 4**: Debounced saving (fix broken saves first)
3. **Phase 2**: Badge infrastructure (build on working saves)
4. **Phase 3**: Session metadata (enhance with context tracking)
5. **Phase 5**: UI refactor (polish)
6. **Phase 6**: Migration & testing (validate)

## Success Criteria

- ✅ Sessions save and load correctly
- ✅ All badges persist across app restarts
- ✅ Session metadata (context, provider/model) is tracked
- ✅ Debounced saving reduces disk I/O
- ✅ UI consistently uses "Session" terminology
- ✅ Old sessions migrate successfully
- ✅ No `window.*` dependencies in session code

