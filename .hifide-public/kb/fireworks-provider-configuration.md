---
id: ad0d913a-5658-4f72-a5d2-b3a8bd4b9089
title: Fireworks Provider Configuration
tags: [provider, fireworks, configuration]
files: [electron/services/ProviderService.ts, electron/data/defaultPricing.ts]
createdAt: 2025-12-06T16:09:27.568Z
updatedAt: 2025-12-06T16:09:27.568Z
---

# Fireworks Provider Configuration

## Setup
1. Obtain an API key from [Fireworks AI](https://fireworks.ai/).
2. Enter the key in the Settings > Providers > Fireworks section.

## Supported Models
The application uses a pre-configured allowlist of models for Fireworks.
Key models include:
- `accounts/fireworks/models/llama-v3p1-405b-instruct`
- `accounts/fireworks/models/deepseek-v3`
- `accounts/fireworks/models/deepseek-r1`
- `accounts/fireworks/models/deepseek-v3p2`
- `accounts/fireworks/models/kimi-k2-thinking` (Reasoning model)

## Pricing
Pricing is configured in `electron/data/defaultPricing.ts`.

## Configuration Files
- `electron/services/ProviderService.ts`: Defines the allowed models list and default recommendations.
- `electron/data/defaultPricing.ts`: Defines the cost per million tokens.
