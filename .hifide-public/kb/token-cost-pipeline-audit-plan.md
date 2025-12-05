---
id: 68eab99c-830f-4d6d-9fca-2f919cf182ba
title: Token & Cost Pipeline Audit Plan
tags: [token-usage, costs, plan]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/session-timeline-writer.ts, src/components/TokensCostsPanel.tsx, src/store/sessionUi.ts]
createdAt: 2025-12-04T17:41:47.291Z
updatedAt: 2025-12-04T17:53:28.368Z
---

## Scope
We need to resolve inaccurate cost display in the Tokens & Costs panel and add observability for provider token usage.

## Current Architecture
- `LLMService` collects provider usage via `onTokenUsage` callbacks, aggregates with `UsageAccumulator`, and emits a `usage_breakdown` execution event once per request.
- `TimelineEventHandler` receives the execution events, calls `SessionTimelineWriter.updateUsage`, and persists session `tokenUsage`, `costs`, and `requestsLog` into the session store.
- `SessionTimelineWriter` relies on `SettingsService.calculateCost` for per-request cost estimation.
- Renderer-side `useSessionUi` store consumes `session.usage.changed` notifications from `event-subscriptions.ts`, and `TokensCostsPanel.tsx` renders aggregate totals, per-provider breakdown, and per-request rows.

## Issues to Address
1. **Missing aggregate cached-cost data** – `SessionTimelineWriter.updateUsage` does not persist `cachedInputCost` or `savings` into the `costs.byProviderAndModel` map (only requestsLog keeps it). As a result, the renderer cannot show cached savings at the top-level summary or per provider/model lines.
2. **Unclear per-request input cost split** – The UI infers “regular input vs cached input” cost by subtracting numbers, which rounds most normal costs down to `$0.0000`. We should provide explicit fields for normal vs cached cost to avoid precision loss.
3. **Observability gap** – We currently log provider usage deltas only when `HF_DEBUG_USAGE` is enabled. We want unconditional logs (with provider/model context) whenever the provider returns raw usage so we can correlate math bugs quickly.

## Implementation Notes
- Introduced `electron/flow-engine/session-cost-utils.ts` with `normalizeTokenCostSnapshot`, `mergeCostBucket`, and `serializeNormalizedCost` helpers (unit-tested) to keep arithmetic pure and portable.
- `SessionTimelineWriter.updateUsage` now normalizes token deltas, tracks reasoning tokens, and persists `cachedInputCostTotal`, `normalInputCostTotal`, and `totalSavings` so renderers receive ready-to-render aggregates.
- `SettingsService.calculateCost` emits `normalInputCost`, letting the renderer show regular vs cached spend without subtraction artifacts.
- `TokensCostsPanel` displays aggregate input-cost breakdowns, per-provider cached spend, and more accurate request rows. Savings calculations reuse the new totals for consistency.
- `LLMService` logs every provider `onTokenUsage` payload so we can correlate backend math with vendor responses regardless of env flags.

## Files to Touch
- `electron/flow-engine/llm-service.ts`
- `electron/flow-engine/session-timeline-writer.ts`
- `electron/flow-engine/session-cost-utils.ts`
- `electron/flow-engine/__tests__/session-timeline-writer-costs.test.ts`
- `electron/services/SettingsService.ts`
- `electron/services/SessionService.ts`
- `electron/store/utils/session-persistence.ts`
- `src/components/TokensCostsPanel.tsx`
- `src/store/sessionUi.ts`
