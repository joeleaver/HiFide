---
id: 29ba236a-3f94-4b5a-bb47-ec95360b5e48
title: Settings Architecture and Data Sync
tags: [settings, architecture, data-sync, providers]
files: []
createdAt: 2025-12-04T02:32:44.969Z
updatedAt: 2025-12-04T02:32:44.969Z
---

# Settings Architecture and Data Sync

The Settings pane (`SettingsPane.tsx`) is driven by a `useSettingsSnapshot` hook that synchronizes the frontend with the backend's `SettingsService` and `ProviderService`.

## Data Synchronization
The frontend maintains a `SettingsSnapshot` that is hydrated on mount via `settings.get` and kept fresh via WebSocket subscriptions.

### Events
- **`settings.models.changed`**: Triggered when providers are validated, models are refreshed, or defaults change.
  - Payload: `{ providerValid, modelsByProvider, fireworksAllowedModels, defaultModels }`
- **`settings.pricing.changed`**: Triggered when pricing configuration changes.
  - Payload: `{ pricingConfig, defaultPricingConfig }`
- **`settings.keys.changed`**: Triggered when API keys are updated.
  - Payload: `{ settingsApiKeys }`
- **`app.boot.changed`**: Triggered during app startup/bootstrap.
  - Payload: `{ startupMessage }`

## Components
- **`SettingsPane`**: Main container. Uses `useSettingsSnapshot` to pass data to sub-components.
- **`useApiKeyManagement`**: Handles the form state for API keys. Hydrates from the snapshot but maintains local state for editing. Saves keys via `settings.setApiKeys`.
- **`PricingSettings`**: Managed component for cost estimation configuration.

## Key Behaviors
- **Default Models**: When the backend auto-selects a default model (e.g. during refresh), it emits `provider:models:changed` which includes `defaultModels`. The frontend hook catches this and updates the dropdowns instantly.
- **API Keys**: Keys are persisted in `SettingsService`. Changes emit `apiKeys:changed` (mapped to `settings.keys.changed` for frontend), ensuring all windows reflect the current keys.
- **Fireworks Allowlist**: Managed via `provider.addFireworksModel` / `removeFireworksModel`, which return the updated list directly, but also trigger global updates.

## Troubleshooting
- **Dropdowns stuck/empty**: Check if `ProviderService` failed to fetch models. The `provider:models:changed` event should carry the latest state.
- **"Reverting" keys**: Ensure `useSettingsSnapshot` is subscribing to `settings.keys.changed`.
