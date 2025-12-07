---
id: 9af1eb5c-3469-4ad7-b5be-d976ff5177e3
title: Tokens & Costs Panel per-request layout
tags: [ui, tokens, layout]
files: [src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-07T00:22:13.279Z
updatedAt: 2025-12-07T00:24:11.663Z
---

## Overview
The per-request section in `TokensCostsPanel` presents each request in a compact card to conserve vertical space while retaining telemetry.

## Layout Guidelines
- Keep provider/model, node ID, execution ID, timestamp, and cached-percentage badge visible in the card header.
- Replace the old `LabelValueRow` stack with a responsive 3-column grid of metrics (`Input`, `Cached input`, `Output`). Each column uses the shared `RequestMetric` helper (which wraps `MetricValue`) to show token counts, currency cost, and optional subtitles (cached % of input or reasoning tokens).
- Cards use `padding="xs"`, `radius="sm"`, and a `SimpleGrid` with breakpoints (`cols=3`, 2 when `<62em`, 1 when `<40em`).

## Files
- `src/components/TokensCostsPanel.tsx`