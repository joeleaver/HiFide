---
id: 68b0fa40-c564-4dd2-b95c-7aa081fb1ecb
title: Model defaults & pricing: JSON source of truth
tags: [models, config, pricing, allowlist, architecture]
files: [electron/data/defaultModelSettings.json, electron/services/SettingsService.ts, electron/services/ProviderService.ts, electron/backend/ws/handlers/settings-handlers.ts, src/store/sessionUi.ts, src/store/hydration.ts, electron/backend/ws/snapshot.ts]
createdAt: 2025-12-15T17:46:15.657Z
updatedAt: 2026-01-03T18:22:05.243Z
---

---
id: 68b0fa40-c564-4dd2-b95c-7aa081fb1ecb
title: Model defaults & pricing: JSON source of truth
tags: [models, config, pricing, allowlist, architecture]
files: [electron/data/defaultModelSettings.json, electron/services/SettingsService.ts, electron/services/ProviderService.ts, electron/backend/ws/handlers/settings-handlers.ts, src/store/sessionUi.ts, src/store/hydration.ts, electron/backend/ws/snapshot.ts]
createdAt: 2025-12-15T17:46:15.657Z
updatedAt: 2026-01-01T20:25:00.000Z
---

# Model defaults & pricing: JSON source of truth

## Goal
`electron/data/defaultModelSettings.json` is the **single source of truth** for which *default/built-in* models exist in the app.

Allowed exceptions:
- **User-created Fireworks model overrides** via the Fireworks allowlist controls.
- **User-created OpenRouter model overrides** via the OpenRouter allowlist controls.

## Invariants
1) **Model existence allowlist = `defaultModelSettings.json.pricing` keys**.
   - If a model id is not present under `pricing.<provider>`, it must not appear in any model picker.
2) `pricingConfig` is **not a model registry**.
   - Settings may only store pricing overrides for models that already exist in defaults.
3) Fireworks and OpenRouter are special:
   - Default models come from `pricing.fireworks`/`pricing.openrouter` keys.
   - Users can extend the allowlist at runtime; those extra models can exist even if not in defaults.

## Enforcement points
### Backend
- `electron/services/SettingsService.ts`
  - On startup, clamps persisted `pricingConfig` to the defaults allowlist (drops extra models).
  - EXCEPTION: For **Fireworks** and **OpenRouter**, persists custom model pricing and overrides, merging them with defaults.
  - Rejects `setPricingForModel` for non-default models (except Fireworks and OpenRouter).

- `electron/services/ProviderService.ts`
  - When refreshing models from provider APIs, filters fetched lists to defaults allowlist (`filterToDefaults`).
  - When setting `modelsByProvider`, clamps to defaults allowlist at the setter boundary.
  - EXCEPTION: `fireworksAllowedModels` and `openrouterAllowedModels` are explicitly merged into `modelsByProvider`.

### Renderer
- The renderer must **never** merge raw provider catalogs into its own store.
  - `modelsByProvider` shown in pickers must come from the backend snapshot/events.

## Bootstrap ordering requirement
`SettingsService` must initialize **before** `ProviderService` so that:
- default pricing is loaded/clamped
- provider model refresh + events cannot run against uninitialized settings

(Implemented in `electron/services/index.ts`.)