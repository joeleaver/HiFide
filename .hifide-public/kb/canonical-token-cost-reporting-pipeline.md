---
id: dd39d29c-bf23-4e63-9e5e-175fe7b9d657
title: Canonical token & cost reporting pipeline
tags: [usage, tokens-costs, architecture]
files: [electron/flow-engine/session-cost-utils.ts, electron/flow-engine/session-timeline-writer.ts, src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-04T23:14:03.716Z
updatedAt: 2025-12-04T23:14:03.716Z
---

## Overview
Token/cost reporting is now modeled as a strict three-way split everywhere: **input**, **cached input**, and **output** plus an explicit `totalCost`.

### Backend
- `electron/flow-engine/session-cost-utils.ts` exposes `normalizeTokenCostSnapshot`, `mergeCostBucket`, and `serializeNormalizedCost`. These helpers accept any provider cost payload (`TokenCost`) and normalize it into:
  - `inputCost`
  - `cachedCost`
  - `outputCost`
  - `totalCost`
  - `currency`
- `electron/flow-engine/session-timeline-writer.ts` imports these helpers to aggregate per-request usage into the session:
  - Session totals now store `inputCost`, `cachedCost`, `outputCost`, and `totalCost`.
  - `costs.byProviderAndModel[provider][model]` accumulates the same canonical fields via `mergeCostBucket`.
  - Each `requestsLog` entry serializes the normalized cost snapshot so the renderer receives the canonical fields with no heuristics.

### Renderer
- `src/components/TokensCostsPanel.tsx` consumes `sessionUi.tokenUsage` and `sessionUi.costs` assuming the canonical contract. All UI sections (session summary, provider/model grid, per-request list) read and display only:
  - `inputTokens`, `cachedTokens`, `outputTokens`
  - `inputCost`, `cachedCost`, `outputCost`, `totalCost`
- The previous "live" vs. cached split, inferred deltas, and fallback math were removed; the panel is now a thin formatter on top of the backend totals.

### Implications
- Providers must emit accurate cost structures (or rely on `calculateCost`) so that cached vs. non-cached accounting is handled upstream.
- Any future UI needs (e.g., cached savings) should be derived from these canonical fields rather than introducing new heuristics in the renderer.
