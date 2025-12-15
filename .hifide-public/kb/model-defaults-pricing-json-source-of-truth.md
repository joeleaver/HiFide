---
id: 68b0fa40-c564-4dd2-b95c-7aa081fb1ecb
title: Model defaults & pricing: JSON source of truth
tags: [models, config, pricing, kb]
files: [electron/data/defaultPricing.ts, electron/services/SettingsService.ts]
createdAt: 2025-12-15T17:46:15.657Z
updatedAt: 2025-12-15T18:04:35.909Z
---

# Model defaults & pricing: JSON source of truth

## Source of truth file
- `electron/data/defaultModelSettings.json`

## Runtime lookup & packaging
The main process loads this JSON at runtime.

The loader (`electron/data/defaultModelSettings.ts`) searches several locations to work in dev, tests, and packaged builds:
- `dist-electron/defaultModelSettings.json` (dev build output)
- `electron/data/defaultModelSettings.json` (source tree fallback)
- `process.resourcesPath/defaultModelSettings.json` (typical electron-builder packaged resources)

**Build step:** `vite.config.ts` includes a `copy-default-model-settings` plugin that copies:
- from `electron/data/defaultModelSettings.json`
- to `dist-electron/defaultModelSettings.json`

## Precedence for runtime sampling defaults
Highest → lowest:
1. per-request overrides (e.g. requestReasoningEffort)
2. `context.modelOverrides[]`
3. `context.temperature` / `context.reasoningEffort` / etc.
4. JSON defaults (`defaultModelSettings.json`)
5. internal fallbacks
