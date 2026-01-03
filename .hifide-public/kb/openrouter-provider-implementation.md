---
id: 91e5cbc1-f72e-4e78-b656-1e3549c48329
title: OpenRouter Provider Implementation
tags: [openrouter, provider, integration, settings, ai-sdk, architecture, sampling, ui]
files: [electron/providers-ai-sdk/openrouter.ts, electron/flow-engine/llm/stream-options.ts]
createdAt: 2026-01-03T16:18:39.118Z
updatedAt: 2026-01-03T21:40:40.591Z
---

# OpenRouter Provider Implementation

## Overview
OpenRouter is integrated as a first-class provider using the AI SDK. It supports standard sampling controls (temperature) and advanced features like extended thinking (reasoning) depending on the underlying model.

## Temperature Mapping
OpenRouter uses a **0.0 to 1.0** temperature range. 
In the `llmRequest` node and global context, temperatures are normalized to a **0-1** scale.
- **Backend Resolution:** `electron/flow-engine/llm/stream-options.ts` maps normalized 1.0 to 1.0 for OpenRouter (matching Anthropic behavior).
- **UI Resolution:** `src/components/FlowNode/SamplingControls.tsx` detects the provider and ensures the temperature slider is visible and uses the correct range labels.

## UI Visibility Logic
The temperature control in the `llmRequest` node is conditionally visible based on the provider.
- **Heuristic Detection:** The UI attempts to parse the model string (e.g., `openrouter:google/gemini-3...`) to identify the provider.
- **Explicit Override:** If the heuristic fails but the `provider` is explicitly set to `openrouter` in the node configuration, the controls are shown.
- **Prefix Handling:** The UI correctly handles `openrouter:` prefixes and `openrouter/` path formats.

## Extended Thinking (Reasoning)
OpenRouter models support "Extended Thinking" if the underlying model supports it (e.g., Gemini 2.0+, Claude 3.5+).
- The `supportsThinking` function in `SamplingControls.tsx` checks both the provider name and the model name to enable the budget slider.
- Budget is passed to the backend and resolved in `resolveSamplingControls`.

## Files
- `electron/providers-ai-sdk/openrouter.ts`: Provider implementation.
- `electron/flow-engine/llm/stream-options.ts`: Server-side sampling logic.
- `src/components/FlowNode/SamplingControls.tsx`: UI for sampling and thinking controls.
- `src/components/FlowNode/configSections/LLMRequestConfig.tsx`: Integration into the request node.