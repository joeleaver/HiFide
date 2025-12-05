---
id: 2c4528e7-e38e-4a56-b79f-49bc8321ede7
title: Tokens & Costs panel layout redesign plan
tags: [ui, tokens, costs, design]
files: [src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-04T18:39:08.495Z
updatedAt: 2025-12-04T18:45:26.340Z
---

## Problem
Even after the initial layout refresh, cached tokens still appear as parenthetical footnotes inside input totals. Users cannot quickly answer:
- How many cached tokens/costs they emitted overall.
- Which providers/models/requests benefitted from caching versus regular input.

## Goals
1. Treat cached input as a **first-class billing lane** anywhere we display tokens or cost.
2. Provide side-by-side comparison of live vs cached input at the session, provider/model, and request level without forcing mental math.
3. Preserve the concise session snapshot, provider/model grouping, and per-request chronology from the previous redesign.

## Layout Updates
1. **Summary Grid (top row)**
   - Keep Total Tokens + Total Cost cards.
   - Replace "Cached savings" card with **Cached Input**: headline shows cached token count, sub-label shows cached cost + savings percent. When there are no cached tokens, display "—" but keep the dedicated slot to reinforce the mental model.
2. **Input Lanes Card**
   - Rename to "INPUT LANES" and render a two-column grid:
     - Column A: Live Input (tokens + cost).
     - Column B: Cached Input (tokens + cost + savings badge when applicable).
   - Show reasoning tokens as a badge spanning both lanes.
3. **Provider & Model Section**
   - Each model card now renders a mini table with separate rows for:
     - Live Input tokens/cost.
     - Cached Input tokens/cost (hidden only when both are zero).
     - Output tokens/cost.
   - Cached rows use a consistent orange accent and a "cached" tag to match the summary language.
4. **Requests History**
   - Within each request card, promote cached data into its own rows:
     - "Live input" and "Cached input" rows, each with tokens and cost.
     - Remove parentheses inside the live row.
   - Add a right-aligned badge showing `% cached` for that request when cached tokens exist.

## Implementation Notes
- Add helper selectors for `liveInputTokens = totalUsage.inputTokens - (totalUsage.cachedTokens || 0)` and similar cost helpers to avoid duplicating math inside JSX.
- The UI surface should never hide cached metrics behind parentheses; prefer dedicated `LabelValueRow`s or badges.
- Maintain `useSessionUi` as the single data source and keep formatting helpers (`formatCurrency`, `formatTokens`, `formatTimestamp`).
- Treat missing cached data as zero but keep the visual slots for consistency, so panels do not jump when caching toggles on/off mid-session.

## Files
- `src/components/TokensCostsPanel.tsx`