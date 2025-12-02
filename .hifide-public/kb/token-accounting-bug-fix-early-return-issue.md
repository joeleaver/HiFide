---
id: 1da0dc86-8d3a-4bc0-ab72-1ef43ab4c8a4
title: Token Accounting Bug Fix - Early Return Issue
tags: [bug-fix, token-accounting, timeline-handler]
files: [electron/flow-engine/timeline-event-handler.ts, electron/flow-engine/scheduler.ts, src/renderer-logger.ts, electron/logger.ts]
createdAt: 2025-12-02T00:14:19.484Z
updatedAt: 2025-12-02T00:14:19.484Z
---

## Critical Bug Fixed

### The Problem
Token accounting was completely broken - all token counts showed as zero despite the LLM providers reporting real token usage.

### Root Cause
In `timeline-event-handler.ts`, the event listener had an early return that prevented `tokenUsage` events from being processed:

```javascript
const unsubscribe = flowEvents.onFlowEvent(requestId, (ev: any) => {
  const { type, nodeId, executionId } = ev
  if (!nodeId) return  // ← tokenUsage events don't have nodeId!
  
  switch (type) {
    case 'tokenUsage':  // ← Never reached!
```

Because `tokenUsage` events don't have a `nodeId` field (unlike `chunk`, `toolStart`, etc.), the handler would return early before reaching the switch statement.

### The Fix
Moved tokenUsage handling BEFORE the `if (!nodeId) return` check:

```javascript
const unsubscribe = flowEvents.onFlowEvent(requestId, (ev: any) => {
  const { type, nodeId, executionId } = ev
  
  // Handle tokenUsage events (which don't have nodeId) separately
  if (type === 'tokenUsage') {
    // ... accumulation logic ...
    return
  }
  
  if (!nodeId) return  // Now safe for other event types
  
  switch (type) {
    // ... other cases ...
```

### Additional Fixes
1. **Logger redaction** - Changed regex from `/token/i` to `/^token$/i` to only redact auth tokens, not token counts
2. **Missing cachedTokens** - Added `cachedTokens` to scheduler's usage event emission

### Files Modified
- `electron/flow-engine/timeline-event-handler.ts` - Fixed early return blocking tokenUsage
- `electron/flow-engine/scheduler.ts` - Added cachedTokens to usage events
- `src/renderer-logger.ts` - Fixed over-aggressive token redaction
- `electron/logger.ts` - Fixed over-aggressive token redaction
