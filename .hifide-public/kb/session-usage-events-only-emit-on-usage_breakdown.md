---
id: 43debf62-ef25-4d12-8a3a-eb7418e8e1a1
title: Session usage events only emit on usage_breakdown
tags: [usage, performance, llm-service]
files: [electron/flow-engine/timeline-event-handler.ts]
createdAt: 2025-12-05T00:32:40.092Z
updatedAt: 2025-12-05T00:32:40.092Z
---

## Overview
`session.usage.changed` notifications (feeding the renderer's `__setUsage` handler) are now emitted only after a provider returns real usage totals. The Flow timeline no longer calls `SessionTimelineWriter.updateUsage` for `tokenUsage` execution events, which could fire once per streaming chunk and caused renderer rerender storms.

## Implementation
- `electron/flow-engine/timeline-event-handler.ts`
  - The `type === 'tokenUsage'` branch now ignores the event (debug-logs only). We rely on the `usageBreakdown` event—emitted once per completed LLM call—to update usage totals.
- `SessionTimelineWriter.updateUsage` is now invoked solely from the `usageBreakdown` case, so `session.usage.changed` broadcasts happen once per request.

## Operational Notes
- Usage totals and costs still update because `LLMService` always emits a `usage_breakdown` event after a successful call.
- If `HF_FLOW_DEBUG=1`, token usage events are logged for diagnostics, but they no longer mutate session state or ping the renderer.
