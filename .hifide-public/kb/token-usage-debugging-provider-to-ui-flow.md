---
id: 0af151cd-2ef5-430e-8432-e61de0270060
title: Token Usage Debugging - Provider to UI Flow
tags: [debugging, tokens, usage-tracking, data-flow]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/execution-events.ts, electron/flow-engine/scheduler.ts, electron/flow-engine/timeline-event-handler.ts]
createdAt: 2025-12-02T00:05:15.724Z
updatedAt: 2025-12-02T00:05:15.724Z
---

## Token Usage Data Flow

The token usage data flows through several layers:

1. **Provider** (e.g., `anthropic.ts`) → calls `onTokenUsage(usage)` with token counts
2. **execution-events.ts** → `onTokenUsage` callback emits `{ type: 'usage', ...usage }` event
3. **scheduler.ts** → handles `'usage'` event, transforms to `'tokenUsage'` flow event
4. **timeline-event-handler.ts** → accumulates tokenUsage events into session state
5. **SessionService** → broadcasts `session.usage.changed` to UI
6. **sessionUi.ts** → receives event, updates Zustand store
7. **TokensCostsPanel.tsx** → renders from Zustand store

## Debugging Added

### Files Modified with Logging:
- `electron/flow-engine/llm-service.ts` - Forced `DEBUG_USAGE = true`
- `electron/flow-engine/execution-events.ts` - Added logging when emitting usage events
- `electron/flow-engine/scheduler.ts` - Added logging when receiving/transforming usage events
- `electron/flow-engine/timeline-event-handler.ts` - Already has logging for tokenUsage

### Expected Log Sequence:
```
[usage:onTokenUsageWrapped] - Shows delta calculation from provider data
[execution-events.onTokenUsage] Emitting usage event: {...}
[scheduler.handleExecutionEvent] Received usage event: {...}
[scheduler.handleExecutionEvent] Emitting tokenUsage flow event
[TimelineEventHandler] tokenUsage event received: {...}
[TimelineEventHandler] tokenUsage: calling broadcastUsage with: {...}
[sessionUi] Received session.usage.changed event: {...}
```

## Issues Fixed So Far:
1. ✅ Logger redaction regex
2. ✅ Missing cachedTokens in scheduler emission
3. ⏳ Investigating why provider usage data might be zeros

## Next Step:
Run an LLM request and check if usage data appears in the logs. If usage is still zero, the problem is in the provider's reporting of token counts.