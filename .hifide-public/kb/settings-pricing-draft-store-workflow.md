---
id: 2d0a6aef-99d4-4753-9818-ec11f26dfec4
title: Settings pricing draft store workflow
tags: [settings, frontend, state-management, pricing]
files: [src/store/settingsPricingDraft.ts, src/SettingsPane.tsx, src/components/PricingSettings.tsx]
createdAt: 2025-12-07T02:59:45.366Z
updatedAt: 2025-12-07T02:59:45.366Z
---

To keep the Settings screen responsive, pricing edits are now staged in a dedicated zustand store before any backend RPC runs. The store (`src/store/settingsPricingDraft.ts`) tracks three copies of the pricing config:

- **baseline** – matching the last `settings.get` snapshot received from the backend.
- **draft** – the mutable copy that drives the UI while the user edits rates.
- **defaults** – the default pricing table used when "Reset" controls are invoked.

`SettingsPane` hydrates the store inside a `useEffect` whenever the snapshot or defaults change. `PricingSettings` no longer issues RPCs inside `NumberInput` handlers; it reads the draft config from the store and calls `updateModelPricing`, `resetProviderToDefault`, or `resetAllToDefaults` to mutate local state. Dirty providers are tracked inside the store so the UI can show save/discard controls only when needed.

The save button now calls `persistDraft()`, which diffs the draft against the baseline and issues the minimum set of `settings.setPricingForModel` RPC calls. On success it updates the settings snapshot via `mergeSnapshot` so the rest of the screen stays in sync.
