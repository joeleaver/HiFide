---
id: 234e9eeb-a5f8-4f84-ba32-6843943c73c0
title: Settings pane data audit and refactor plan
tags: [ui, settings, audit, provider]
files: [src/SettingsPane.tsx, src/hooks/useApiKeyManagement.ts, electron/backend/ws/handlers/settings-handlers.ts, electron/services/ProviderService.ts, electron/services/SettingsService.ts]
createdAt: 2025-12-04T00:14:11.727Z
updatedAt: 2025-12-04T00:14:11.727Z
---

## Current data flow
- `SettingsPane` (renderer) hydrates API keys via `useApiKeyManagement`, but the hook is invoked with `autoHydrate=false` and never told to `hydrate()`, so `apiKeys`/`providerValid` remain empty. The snapshot for models/defaults/autoRetry/startup banner is fetched once via `settings.get`, which proxies to both `SettingsService` (API keys, pricing) and `ProviderService` (models, defaults, autoRetry, Fireworks allowlist) inside `electron/backend/ws/handlers/settings-handlers.ts`.
- `SettingsService` persists API keys and pricing under the `settings` store; `ProviderService` persists selected provider/model, default models, auto-retry, and `fireworksAllowedModels` under the `provider` store.

## Renderer/backend mismatches confirmed 2025‑12‑04
1. **API keys never hydrate**: Because `useApiKeyManagement(false)` is used without calling `hydrate()`, previously saved keys and provider validation state never reach the form, which also keeps every “Default Model” `<Select>` disabled (`providerValid.openai` is `undefined`).
2. **Fireworks allowlist RPCs are broken**: The UI calls `provider.fireworks.add/remove`, but the backend only exposes `provider.addFireworksModel/removeFireworksModel`. As a result the allowlist buttons throw `Method not found` and the UI never updates `fireworksAllowedModels` in `ProviderService`.
3. **Load defaults stub**: The renderer still calls `provider.fireworks.loadDefaults`, yet the handler was replaced with a no-op stub; the real logic lives in `ProviderService.loadFireworksRecommendedDefaults` but is not wired to any RPC.
4. **Startup banner always hidden**: `settings.get` hardcodes `startupMessage: null` even though `AppService` maintains the real text. The Settings pane therefore never shows “Configuration Required” messaging despite `AppService.setStartupMessage` being updated during boot/validation.

## Refactor plan
- Introduce a typed `SettingsSnapshot` returned by `settings.get` that includes the real `startupMessage`, API keys, pricing, provider validity, default models, Fireworks allowlist, and (eventually) other agent-behavior flags.
- Create a dedicated `useSettingsSnapshot` hook that (a) awaits `client.whenReady`, (b) hydrates once on mount, and (c) subscribes to backend events (`provider:models:changed`, a new `settings:pricing:changed`, etc.) so the Settings pane stays in sync without manual re-fetch loops.
- Update `SettingsPane` to call `useApiKeyManagement(true)` or manually invoke `hydrate()` on mount so API keys and validation badges render correctly.
- Replace `provider.fireworks.*` RPC usages with the real handler names (`provider.addFireworksModel`, `provider.removeFireworksModel`) and add a new RPC (or fix `provider.fireworks.loadDefaults`) that calls `ProviderService.loadFireworksRecommendedDefaults`.
- Extend `settings.get`/+handlers to plumb through `AppService.getStartupMessage()` so the alert reflects actual backend state, and ensure Fireworks RPC mutations return the updated allowlist/models to eliminate ad-hoc follow-up `settings.get` calls.
