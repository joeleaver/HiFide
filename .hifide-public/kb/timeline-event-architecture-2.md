---
id: 1f65244d-18b3-45c6-8fba-eeddd26a7465
title: Timeline Event Architecture
tags: [architecture, events, usage, timeline]
files: [electron/flow-engine/timeline-event-handler.ts, electron/flow-engine/scheduler.ts, electron/flow-engine/llm-service.ts]
createdAt: 2025-12-04T14:22:30.856Z
updatedAt: 2025-12-04T14:22:30.856Z
---

# Timeline Event & Usage Flow

## Event Lifecycle
1. **Origin (LLMService):** Emits `usage_breakdown` (snake_case) with payload `{ usageBreakdown: ... }`.
2. **Router (Scheduler):** Intercepts `usage_breakdown`, re-emits via `broadcastFlowEvent` as `usageBreakdown` (camelCase) with payload `{ breakdown: ... }` (renamed property).
3. **Consumer (TimelineEventHandler):** Listens for `usageBreakdown`, accesses `ev.breakdown`, updates session totals, and emits badge.

## Critical Keys
- **Event Type:** `usageBreakdown` (in TimelineEventHandler)
- **Data Property:** `breakdown` (or `usageBreakdown` for robustness)
- **Badge ID:** `usage-{executionId}`

## Debugging
- If usage totals are 0: Check `TimelineEventHandler` is receiving `usageBreakdown` and `writer.updateUsage` is called.
- If badge is missing: Check `usageBreakdown` case in `TimelineEventHandler`.