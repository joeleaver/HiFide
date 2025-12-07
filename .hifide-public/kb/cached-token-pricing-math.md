---
id: e56cfbfa-32a2-4e18-b034-e6560c0ea353
title: Cached token pricing math
tags: [usage, pricing, tokens]
files: [electron/services/settings-cost-utils.ts, electron/services/SettingsService.ts, src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-06T23:49:26.935Z
updatedAt: 2025-12-06T23:53:20.607Z
---

**Context**
- Token usage events emitted by providers (OpenAI, Gemini, Fireworks, etc.) already separate _billable_ input tokens from cached/contextual hits.
- `usage.inputTokens` represents the tokens charged at the model’s standard input rate.
- `usage.cachedTokens` contains the tokens served from cache/context windows that are charged at the reduced cached-input rate (or free).

**Implication for pricing**
- The renderer (e.g., `src/components/TokensCostsPanel.tsx`) expects cached vs non-cached tokens to be shown as two distinct buckets using the formula `cachedTokens / (cachedTokens + inputTokens)`.
- Therefore, cost calculations should **never subtract** cached tokens from `usage.inputTokens`. Doing so zeroes-out or under-reports real input costs whenever cached tokens exist.

**Implementation guidance**
- `electron/services/settings-cost-utils.ts` exports `computeTokenCost`, the canonical helper used by `SettingsService.calculateCost`.
- Treat `usage.inputTokens` as normal (billable) tokens and `usage.cachedTokens` as the discounted bucket.
- Compute:
  - `normalInputCost = (inputTokens / 1_000_000) * pricing.inputCostPer1M`
  - `cachedInputCost = (cachedTokens / 1_000_000) * (pricing.cachedInputCostPer1M ?? pricing.inputCostPer1M)`
  - `inputCost = normalInputCost + cachedInputCost`
- Continue calculating savings by comparing cached tokens at full price vs discounted cached price.

This keeps the backend cost math aligned with the renderer’s token breakdown and stops cached usage from erasing normal input costs.