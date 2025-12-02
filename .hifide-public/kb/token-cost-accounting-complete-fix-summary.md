---
id: 011ba4a7-ef6f-4eb2-a56e-70411832d896
title: Token & Cost Accounting - Complete Fix Summary
tags: [bug-fix, token-accounting, costs, ui, events]
files: [src/renderer-logger.ts, electron/logger.ts, electron/flow-engine/scheduler.ts, electron/flow-engine/timeline-event-handler.ts, src/store/sessionUi.ts, src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-02T00:29:01.691Z
updatedAt: 2025-12-02T00:29:01.691Z
---

## Fixed Issues

### 1. Logger Redacting Token Counts ✅
**Problem**: The redaction regex was matching any key containing "token", which included token counts like `inputTokens`, `outputTokens`, etc., causing them to be replaced with `"***REDACTED***"`.

**Fix**: Changed regex from `/token/i` (matches "token" anywhere) to `/^token$/i` (only matches exact "token").

**Files**: 
- `src/renderer-logger.ts`
- `electron/logger.ts`

### 2. Missing cachedTokens in Events ✅
**Problem**: Scheduler wasn't passing `cachedTokens` when transforming usage events to flow events.

**Fix**: Added `cachedTokens: event.usage.cachedTokens || 0` to the emitted usage object.

**File**: `electron/flow-engine/scheduler.ts`

### 3. Event Handler Early Return Bug ✅
**Problem**: The `tokenUsage` event handler had an early return check `if (!nodeId) return` **before** the switch statement. Since `tokenUsage` events don't have a `nodeId` field, they were always returning early and never reaching the accumulation logic.

**Fix**: Moved the tokenUsage handler **before** the early return check, so it processes regardless of nodeId presence.

**File**: `electron/flow-engine/timeline-event-handler.ts`

### 4. Incorrect Parameter Destructuring ✅
**Problem**: The event subscription was passing the entire payload object as a single argument: `__setUsage(p)`, but the function expected three separate parameters: `__setUsage(tokenUsage, costs, requestsLog)`. This caused `tokenUsage` to be nested incorrectly.

**Fix**: Changed to properly destructure: `__setUsage(p.tokenUsage, p.costs, p.requestsLog)`.

**File**: `src/store/sessionUi.ts`

## Test Results

After fixes, the token flow works correctly:
1. ✅ LLM provider reports usage
2. ✅ Scheduler emits tokenUsage events with all fields
3. ✅ Timeline handler accumulates tokens into session
4. ✅ Session broadcasts usage updates to UI
5. ✅ UI displays real token counts (not "***REDACTED***")
6. ✅ Tokens & Costs panel shows accurate data
7. ✅ Usage badges appear after LLM request nodes complete

## Data Flow

```
Provider → onTokenUsageWrapped → emit('usage') → 
Scheduler → emit('tokenUsage') → 
TimelineHandler → accumulate & save → broadcastUsage() →
WebSocket → session.usage.changed →
sessionUi.__setUsage() → 
TokensCostsPanel (re-renders)
```