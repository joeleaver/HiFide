---
id: 99826903-34f2-4469-a4af-ac18d4ca6d8b
title: Token Accounting Bug Fix - Complete Resolution
tags: [bug-fix, token-accounting, telemetry, ui]
files: [src/renderer-logger.ts, electron/logger.ts, electron/flow-engine/scheduler.ts, electron/flow-engine/timeline-event-handler.ts, src/store/sessionUi.ts]
createdAt: 2025-12-02T00:20:12.455Z
updatedAt: 2025-12-02T00:20:12.455Z
---

## Issue
Token usage data was not appearing in the Tokens & Costs panel. All token counts showed as zero or "***REDACTED***".

## Root Causes Found

### 1. Logger Redaction Bug
**File**: `src/renderer-logger.ts`, `electron/logger.ts`

**Problem**: The redaction regex `/token/i` was matching ANY key containing "token", including:
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `cachedTokens`

**Fix**: Changed regex to `/^token$/i` to only match keys named exactly "token".

### 2. Missing cachedTokens in Events
**File**: `electron/flow-engine/scheduler.ts`

**Problem**: When the scheduler emitted `tokenUsage` flow events, it wasn't including `cachedTokens`.

**Fix**: Added `cachedTokens: event.usage.cachedTokens || 0` to the emitted usage object.

### 3. Early Return Blocking tokenUsage Events
**File**: `electron/flow-engine/timeline-event-handler.ts`

**Problem**: The event listener had `if (!nodeId) return` BEFORE the switch statement. Since `tokenUsage` events don't have a `nodeId`, they were being discarded before reaching the handler.

**Fix**: Moved tokenUsage event handling BEFORE the nodeId check.

### 4. Incorrect Parameter Destructuring
**File**: `src/store/sessionUi.ts`

**Problem**: The event subscription was calling:
```javascript
st.__setUsage(p)  // Passed entire object as first param
```

But `__setUsage` expects three separate parameters:
```javascript
__setUsage: (tokenUsage, costs, requestsLog) => {...}
```

This caused `tokenUsage` to contain the entire payload object, creating nested `tokenUsage.tokenUsage`.

**Fix**: Changed to:
```javascript
st.__setUsage(p.tokenUsage, p.costs, p.requestsLog)
```

## Data Flow (Fixed)

1. **LLM Provider** reports usage via `onTokenUsage` callback
2. **llm-service** accumulates deltas and emits `usage` execution events
3. **Scheduler** transforms `usage` events into `tokenUsage` flow events (with cachedTokens)
4. **Timeline Event Handler** listens for `tokenUsage` events (before nodeId check)
5. **Timeline Handler** accumulates tokens in session storage
6. **Timeline Handler** broadcasts `session.usage.changed` with `{tokenUsage, costs, requestsLog}`
7. **sessionUi store** receives event and calls `__setUsage(p.tokenUsage, p.costs, p.requestsLog)`
8. **Zustand** updates state and notifies subscribers
9. **TokensCostsPanel** re-renders with updated data

## Files Changed

- `src/renderer-logger.ts` - Fixed redaction regex
- `electron/logger.ts` - Fixed redaction regex
- `electron/flow-engine/scheduler.ts` - Added cachedTokens to emitted events
- `electron/flow-engine/timeline-event-handler.ts` - Moved tokenUsage handling before nodeId check
- `src/store/sessionUi.ts` - Fixed parameter destructuring in event subscription

## Testing

After reloading the app and running an LLM request, verify:
- ✅ Token counts show real numbers (not zeros or "***REDACTED***")
- ✅ Tokens accumulate with each request
- ✅ Usage badge appears after LLM request nodes
- ✅ Tokens & Costs panel displays correctly
- ✅ Cached tokens are tracked