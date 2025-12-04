---
id: 6cd5befd-0c0d-479f-acf5-99688b995d45
title: Pricing Configuration and Defaults
tags: []
files: [electron/services/SettingsService.ts, electron/data/defaultPricing.ts, src/components/PricingSettings.tsx]
createdAt: 2025-12-04T02:10:30.633Z
updatedAt: 2025-12-04T02:10:30.633Z
---

# Pricing Configuration and Defaults

The application manages model pricing via `SettingsService`. Pricing is configured per provider and model, with support for:
- Input tokens ($/1M)
- Output tokens ($/1M)
- Cached input tokens ($/1M) - e.g. for Gemini context caching or Prompt Caching

## Default Pricing Merging
On application startup, `SettingsService` automatically merges the codebase's `DEFAULT_PRICING` into the active persisted configuration. This ensures that:
1. New models added to the codebase (e.g. `gpt-5.1`) automatically appear in the user's configuration.
2. Users do not need to manually "Reset to Defaults" to see new models.
3. User-customized rates for existing models are preserved.

## Troubleshooting Zero Costs
If the "Tokens & Costs" panel shows $0.00 for usage:
1. **Check Settings:** Go to Settings > Cost Estimation. Verify the model being used is listed and has non-zero rates.
2. **Missing Model:** If the model is not listed, it may be a new model not yet in `DEFAULT_PRICING` or the API list. 
3. **Reset:** You can try resetting a provider to defaults to force a refresh of the pricing config for that provider.

## Cached Tokens
Savings from cached tokens (Prompt Caching) are calculated automatically if `cachedInputCostPer1M` is defined for the model. The UI displays the savings amount and percentage.