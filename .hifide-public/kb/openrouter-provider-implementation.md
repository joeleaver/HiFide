---
id: 91e5cbc1-f72e-4e78-b656-1e3549c48329
title: OpenRouter Provider Implementation
tags: [openrouter, provider, integration, settings, ai-sdk]
files: [electron/services/ProviderService.ts, electron/providers-ai-sdk/openrouter.ts, src/SettingsPane.tsx]
createdAt: 2026-01-03T16:18:39.118Z
updatedAt: 2026-01-03T17:41:11.553Z
---

# OpenRouter Provider Implementation

OpenRouter integration uses a manual allowlist strategy (mirroring Fireworks) to manage the vast number of available models.

## Architecture

### Backend (`ProviderService.ts`)
*   **Allowlist:** Uses `openrouterAllowedModels` in `ProviderState` to track user-authorized models.
*   **Fetching:** `fetchOpenRouterModels` does **not** call the OpenRouter API. It returns the local allowlist. This avoids fetching thousands of models and strictly enforces manual management.
*   **Filtering:** `setModelsForProvider` and `ensureModelsByProviderAllowlist` strictly filter models against the `openrouterAllowedModels` list.
*   **Persistence:** The allowlist is persisted to disk via `electron-store`.
*   **Defaults:** Defaults are loaded from `defaultModelSettings.json` if the allowlist is empty.

### AI SDK Adapter (`electron/providers-ai-sdk/openrouter.ts`)
*   **Factory:** Uses `createOpenRouter({ apiKey })` from `@openrouter/ai-sdk-provider` to create the provider instance.
*   **Streaming:** Implements `agentStream` using `streamText` from Vercel AI SDK.
    *   **Crucial:** The stream returned by `streamText` must be consumed using `result.consumeStream()` (or by iterating `textStream`) to trigger `onChunk` callbacks. Awaiting `streamText` alone only returns the result object and does not drive the stream.
    *   **Reasoning:** Uses `extractReasoningMiddleware({ tagName: 'think' })` to support reasoning models (e.g., DeepSeek R1).
    *   **Artifacts:** Filters out "None" artifacts that sometimes appear at the start of OpenRouter streams.
*   **Output:** Emits `text-delta` for content and `reasoning` events for thinking blocks.

### Frontend (`SettingsPane.tsx`)
*   **UI:** Provides an input field to manually add model IDs (e.g., `meta-llama/llama-3.1-8b-instruct`).
*   **Actions:**
    *   `addOpenRouterModel`: Adds ID to allowlist and refreshes.
    *   `removeOpenRouterModel`: Removes ID from allowlist and refreshes.
    *   `loadOpenRouterDefaults`: Resets allowlist to recommended defaults.

### Key Validation
*   Presence of an API key is checked locally.
*   `providerValid.openrouter` is set to true if a key exists (or if `fetchOpenRouterModels` succeeds, which it always does as it's local).

## Troubleshooting

*   **"No models available":** The user must manually add a model ID in Settings > API Keys > OpenRouter Models.
*   **Provider not in list:** Ensure `providerValid.openrouter` is true (API key entered).
*   **Stream hanging:** Ensure `result.consumeStream()` is called in the adapter.
