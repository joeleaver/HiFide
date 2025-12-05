---
id: 42466856-35f0-4795-b3a2-a03eab5fab5e
title: Token and Cost Usage Architecture
tags: [usage, tokens, costs, architecture, kb]
files: [electron/flow-engine/llm-service.ts, src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-04T22:22:08.577Z
updatedAt: 2025-12-04T22:22:08.577Z
---

# Token and Cost Usage Architecture

## Goals
- Represent token usage and costs with minimal derivation from provider responses.
- Eliminate ambiguous concepts like "live" tokens and derived fallback math.
- Ensure renderer UI mirrors backend usage fields directly.

## Canonical Concepts
There are exactly three kinds of tokens and three cost dimensions:

- **Tokens**
  - `inputTokens`: All non-cached prompt tokens billed at normal input price.
  - `cachedTokens`: Prompt tokens billed at the discounted cached-input price.
  - `outputTokens`: Completion tokens billed at output price.

- **Costs**
  - `inputCost`: Cost for `inputTokens`.
  - `cachedCost`: Cost for `cachedTokens`.
  - `outputCost`: Cost for `outputTokens`.
  - `totalCost = inputCost + cachedCost + outputCost` (up to rounding).

## Backend Contract (`usage_breakdown`)

LLMService must emit `usage_breakdown` events whose payload already contains the canonical fields without requiring the renderer to guess:

```ts
interface CanonicalUsageTotals {
  inputTokens: number
  cachedTokens: number
  outputTokens: number

  inputCost: number
  cachedCost: number
  outputCost: number
  totalCost: number // == inputCost + cachedCost + outputCost
}
```

The event may also contain per-request / per-provider-and-model breakdowns using the same shape.

Any previous fields such as `normalInputCost`, `inputCost` that mixes cached + live, or heuristic splits must be deprecated in favor of this canonical shape.

## Renderer Contract

The renderer `sessionUi` store and `TokensCostsPanel` should:

- Store and display exactly the canonical usage fields from the backend.
- Avoid recomputing `live` vs `cached` costs or inferring costs by subtracting totals.
- Only perform simple aggregates:
  - Sum of `inputTokens`, `cachedTokens`, `outputTokens` per session.
  - Sum of `inputCost`, `cachedCost`, `outputCost` and compute `totalCost` as their sum.

## Migration Notes

- Remove or deprecate fields:
  - `normalInputCost`, `cachedInputCostTotal`, `normalInputCostTotal`, and any `live*`-named variables.
  - Heuristic fallbacks like `inputCost - cachedInputCost`.
- Ensure providers populate canonical usage using their own native response fields, mapping 1:1 into the architecture.
- Add tests that assert consistency:
  - For any `usage_breakdown` payload, `totalCost === inputCost + cachedCost + outputCost`.
  - Tokens and costs in the renderer match the backend payload for sample sessions.
