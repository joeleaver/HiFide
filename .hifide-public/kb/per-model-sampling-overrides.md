---
id: e8baf763-b37a-4979-bc65-38730a634c34
title: Per-model sampling overrides
tags: [llm, sampling, configuration, testing]
files: [electron/flow-engine/llm/stream-options.ts, electron/flow-engine/llm-service.ts, electron/flow-engine/llm/__tests__/stream-options.test.ts, src/components/FlowNode/SamplingControls.tsx, electron/flow-engine/nodes/llmRequest.ts]
createdAt: 2025-12-05T00:20:58.735Z
updatedAt: 2025-12-05T00:23:31.003Z
---

- Model-specific overrides for temperature/reasoning/thinking are stored on `MainFlowContext.modelOverrides` and can be configured via the flow node Sampling Controls UI.
- When an `llmRequest` executes, the context (plus overrides) is passed to `resolveSamplingControls` in `electron/flow-engine/llm/stream-options.ts` before calling `llmService.chat`.
- `resolveSamplingControls` searches `modelOverrides` for the exact model being invoked and, when found, uses the override’s raw temperature/reasoning/thinking values instead of the normalized base context values. If no override is present, it falls back to the normalized temperature (0-1) and maps it to the provider’s range (Anthropic 0–1, OpenAI/Gemini 0–2).
- Regression coverage: `electron/flow-engine/llm/__tests__/stream-options.test.ts` asserts that overrides take precedence and that the fallback path still works.
- To verify at runtime, set `HF_FLOW_DEBUG=1` before launching the app. `llm-service.ts` logs the redacted agentStream config passed to each provider (right before `providerAdapter.agentStream`), so you can inspect the exact temperature/reasoning values the model receives.