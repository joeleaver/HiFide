---
id: c28c4321-df71-4271-8466-91e4e9f647d8
title: Token Accounting Fix - Complete Debugging Summary
tags: [bug-fix, token-accounting, debugging]
files: [electron/logger.ts, src/renderer-logger.ts, electron/flow-engine/scheduler.ts, electron/flow-engine/timeline-event-handler.ts, src/store/sessionUi.ts]
createdAt: 2025-12-02T00:01:16.464Z
updatedAt: 2025-12-02T00:01:16.464Z
---

## Token Accounting Debugging - Complete Fix

### Issues Found and Fixed

1. **Logger Redacting Token Counts** ✅ FIXED
   - **Problem**: Regex `/token/i` was matching any key containing "token", redacting `inputTokens`, `outputTokens`, etc.
   - **Fix**: Changed to `/^token$/i` to only match keys named exactly "token"
   - **Files**: `src/renderer-logger.ts`, `electron/logger.ts`

2. **Missing cachedTokens in Scheduler Events** ✅ FIXED
   - **Problem**: Scheduler wasn't passing `cachedTokens` when emitting token usage events
   - **Fix**: Added `cachedTokens: event.usage.cachedTokens || 0` to the emitted usage object
   - **File**: `electron/flow-engine/scheduler.ts` (line 958)

3. **Debug Logging Added** ✅ ADDED
   - Added comprehensive logging to trace token data flow
   - **Files**:
     - `src/store/sessionUi.ts` - logs event reception and state updates
     - `electron/flow-engine/timeline-event-handler.ts` - logs tokenUsage event processing

### Data Flow

```
LLM Provider (anthropic.ts, etc.)
  ↓ calls onTokenUsage()
LLM Service (llm-service.ts)
  ↓ wraps and accumulates usage
Scheduler (scheduler.ts)
  ↓ emits 'tokenUsage' FlowEvent
Timeline Event Handler (timeline-event-handler.ts)
  ↓ accumulates into session.tokenUsage
  ↓ calls broadcastUsage()
Session Service
  ↓ broadcasts 'session.usage.changed'
SessionUI Store (sessionUi.ts)
  ↓ receives event via client.subscribe()
  ↓ calls __setUsage()
TokensCostsPanel (TokensCostsPanel.tsx)
  ↓ re-renders with new data
```

### Next Test
Run an LLM request and check console for:
1. `[TimelineEventHandler] tokenUsage event received` - confirms events reach handler
2. `[TimelineEventHandler] tokenUsage: calling broadcastUsage` - confirms broadcast happens
3. `[sessionUi] Received session.usage.changed event` - confirms UI receives update
4. Token counts should be non-zero numbers (not "***REDACTED***" or 0)

