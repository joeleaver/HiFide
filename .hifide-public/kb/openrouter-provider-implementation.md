---
id: 91e5cbc1-f72e-4e78-b656-1e3549c48329
title: OpenRouter Provider Implementation
tags: [openrouter, provider, integration, settings, ai-sdk, architecture]
files: [electron/providers-ai-sdk/openrouter.ts, electron/services/ProviderService.ts, electron/services/AppService.ts]
createdAt: 2026-01-03T16:18:39.118Z
updatedAt: 2026-01-03T18:10:16.524Z
---

# OpenRouter Provider Implementation

This article documents the implementation details of the OpenRouter provider integration in HiFide.

## Architecture

The OpenRouter integration follows the standard `AiSdkProvider` pattern but differs in how model lists are managed.

### 1. Allowlist-Based Model Management
Unlike OpenAI or Anthropic, which fetch available models from the API, OpenRouter supports thousands of models. To prevent UI clutter and performance issues, HiFide uses a **local allowlist** for OpenRouter models.

*   **Source of Truth:** `defaultModelSettings.json` (defaults) and user persistence (additions).
*   **ProviderService:**
    *   `fetchOpenRouterModels(key)`: Returns *only* the models currently in the allowlist. It does **not** make a network request to list models.
    *   `ensureModelsByProviderAllowlist()`: Called on startup to populate `modelsByProvider.openrouter` from the persisted allowlist. This ensures models appear immediately without waiting for a "refresh".
    *   `refreshModels('openrouter')`: Re-syncs the `modelsByProvider` state with the allowlist. If the API key is missing or invalid, it gracefully falls back to the allowlist rather than clearing the models.

### 2. Startup Initialization (Crucial)
OpenRouter model visibility relies on correct initialization sequence in `AppService.ts`.

*   **AppService:** Responsible for validating API keys on startup and updating the global `providerValid` state.
*   **Validation Map:** `AppService.initializeApp` constructs a `validMap` of providers. **OpenRouter must be explicitly included here.**
    *   If omitted, `providerService.setProvidersValid(map)` will overwrite the state, potentially setting `openrouter` to `false` (or undefined), causing models to disappear from the UI even if they are loaded in the allowlist.
    *   **Fix (2025):** `AppService.ts` was updated to explicitly extract the `openrouter` API key and include it in the `validMap` construction and validation logic.

### 3. Stream Consumption & Reasoning
The implementation uses Vercel AI SDK's `streamText`.

*   **Stream Consumption:** The `agentStream` method **must** consume the returned stream (e.g., via `result.consumeStream()`) to trigger `onChunk` callbacks. Simply awaiting the result is insufficient and leads to execution hangs.
*   **Reasoning:** Models like `deepseek-r1` emit reasoning via a `<think>` tag or specific chunk types. The `onChunk` handler processes `reasoning` chunks and standard text deltas.
*   **"None" Artifacts:** The implementation filters out "None" strings that occasionally appear in OpenRouter streams.

## Key Files

*   `electron/providers-ai-sdk/openrouter.ts`: Core provider implementation (streaming, execution).
*   `electron/services/ProviderService.ts`: Model management, allowlist logic.
*   `electron/services/AppService.ts`: Startup validation and provider status initialization.
*   `electron/data/defaultModelSettings.json`: Default allowlisted models.

## Troubleshooting

*   **Models appear then disappear:** Check `AppService.ts` to ensure `openrouter` is included in the `validMap` passed to `setProvidersValid`.
*   **Execution hangs:** Ensure `result.consumeStream()` is called in `agentStream`.
*   **Models not showing:** Verify `openrouterAllowedModels` in `ProviderService` state has entries.
