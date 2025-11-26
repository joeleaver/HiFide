# Message History Leak Fix

## Problem

When loading the app with an existing workspace, brand-new conversations were showing message history from previous conversations in the context inspector. This was a critical bug that violated session isolation.

## Root Cause

The issue had two parts:

1. **Session Creation**: When creating new sessions via `newSessionFor()`, the `currentContext` was initialized with only `provider` and `model`, but **no `messageHistory` field**. This meant `messageHistory` was `undefined`.

2. **Session Loading**: When loading sessions from disk via `loadAllSessions()`, the persisted `messageHistory` from previous conversations was being restored into the session's `currentContext`. This meant old conversations were leaking into new flow executions.

## Solution

### 1. Fix Session Creation (`electron/store/slices/session.slice.ts`)

Changed line 285 from:
```typescript
currentContext: { provider: effectiveProvider, model: effectiveModel },
```

To:
```typescript
currentContext: { 
  provider: effectiveProvider, 
  model: effectiveModel,
  messageHistory: [] // Explicitly initialize empty messageHistory
},
```

### 2. Fix Session Loading (`electron/store/utils/session-persistence.ts`)

Changed line 184 from:
```typescript
messageHistory: Array.isArray(ctx.messageHistory) ? ctx.messageHistory : undefined,
```

To:
```typescript
// messageHistory is always empty when loading from disk
messageHistory: [],
```

Added comment explaining the design decision:
```typescript
// NOTE: messageHistory is intentionally NOT loaded from disk
// Each new conversation should start fresh with empty messageHistory
// The timeline items preserve the conversation history for display
```

## Design Rationale

**Why not persist `messageHistory`?**

1. **Session Timeline is the Source of Truth**: The session's `items` array contains the complete conversation history for display purposes. This is what gets persisted and loaded.

2. **Flow Context is Ephemeral**: The `messageHistory` in `currentContext` is only used during active flow execution. It should start empty for each new conversation.

3. **Clean Separation**: This creates a clean separation between:
   - **Persistent conversation history** → `session.items` (for display)
   - **Active execution context** → `session.currentContext.messageHistory` (for LLM)

4. **Prevents Leakage**: By always starting with empty `messageHistory`, we guarantee that new conversations never accidentally include messages from previous conversations.

## Verification

The fix ensures:

✅ **New sessions** start with `messageHistory: []`  
✅ **Loaded sessions** start with `messageHistory: []`  
✅ **New Context button** clears `messageHistory: []` (already working)  
✅ **Flow execution** receives empty `messageHistory` for new conversations  
✅ **Session switching** doesn't leak messages between sessions  

## Related Code

- `electron/store/slices/session.slice.ts::newSessionFor()` - Creates new sessions
- `electron/store/utils/session-persistence.ts::loadAllSessions()` - Loads sessions from disk
- `electron/store/slices/session.slice.ts::startNewContext()` - Clears messageHistory (already correct)
- `electron/store/slices/flowEditor.slice.ts::flowInit()` - Passes session context to scheduler
- `electron/ipc/flows-v2/scheduler.ts` - Initializes main context from session context

## Testing

To verify the fix:

1. **Create new session** → Check context inspector shows `messageHistory: []`
2. **Send messages** → Verify they appear in context
3. **Create another new session** → Verify `messageHistory: []` again
4. **Reload app** → Verify loaded session has `messageHistory: []`
5. **Use "New Context" button** → Verify `messageHistory` is cleared
6. **Switch between sessions** → Verify no cross-contamination

