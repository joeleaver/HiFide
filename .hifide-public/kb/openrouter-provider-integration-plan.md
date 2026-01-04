---
id: 0e6bfef8-4935-4bcf-939b-d84e7f91861e
title: OpenRouter Provider Integration Plan
tags: [openrouter, provider, integration, architecture]
files: [electron/services/ProviderService.ts, public/defaultModelSettings.json, src/SettingsPane.tsx]
createdAt: 2026-01-04T16:15:08.445Z
updatedAt: 2026-01-04T16:15:08.445Z
---

# OpenRouter Provider Integration Plan

The OpenRouter integration follows the architectural pattern established for the Fireworks provider. This ensures consistency in how models are discovery, allowlisted, and configured by the user.

## Core Components

1.  **ProviderAdapter**: OpenRouter will use an OpenAI-compatible adapter since its API mirrors OpenAI's structure.
2.  **Allowlist Management**: Like Fireworks, OpenRouter models are not fetched in bulk. Users add specific model IDs (e.g., `anthropic/claude-3-5-sonnet`) to an allowlist in Settings.
3.  **Pricing & Defaults**: Recommended models and their pricing are defined in `public/defaultModelSettings.json`.
4.  **Backend Services**: `ProviderService.ts` manages the `openrouterAllowedModels` state and handles RPC calls for adding/removing models.
5.  **UI Components**: `SettingsPane.tsx` provides the interface for users to manage their OpenRouter model list.

## Implementation Steps

### Phase 1: Foundation
- Update `PricingConfig` and `ModelDefaultsConfig` types in `src/store/types.ts` to include `openrouter`.
- Populate `public/defaultModelSettings.json` with initial OpenRouter models and pricing.

### Phase 2: Service Layer
- Extend `ProviderService.ts` to handle OpenRouter allowlist state (`openrouterAllowedModels`).
- Implement RPC handlers in `ProviderService` for OpenRouter model management (mirroring Fireworks methods).
- Register RPC handlers in `electron/backend/ws/handlers/ui-handlers.ts`.

### Phase 3: Provider Adapter
- Create/Ensure `OpenRouterAdapter` in `electron/providers/`. It should inherit from `OpenAIAdapter` or use the same logic but point to `https://openrouter.ai/api/v1`.

### Phase 4: UI Integration
- Update `SettingsPane.tsx` to include a section for OpenRouter model management.
- Update `ApiKeyInput.tsx` to include the OpenRouter API key field.
- Ensure `SessionUiStore` and `TokensCostsPanel` correctly handle OpenRouter pricing.

## Verification
- Add a model via Settings and verify it appears in the model selector.
- Verify that costs are correctly calculated based on the pricing in `defaultModelSettings.json`.
- Run a test chat using an OpenRouter model.