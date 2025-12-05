---
id: 28f3003a-91c9-4c3a-b8f8-6cb6d5f942f2
title: LLM request config logging
tags: [llm-service, logging, llm]
files: [electron/flow-engine/llm-service.ts]
createdAt: 2025-12-05T00:24:39.665Z
updatedAt: 2025-12-05T00:24:39.665Z
---

The LLM service now always logs the final config object it passes to each provider call. In `electron/flow-engine/llm-service.ts`, right before invoking `providerAdapter.agentStream` we clone `agentStreamConfig`, strip the `apiKey`, and emit `console.log('[llm-service] agentStream config', { provider, model, config })`. This log no longer depends on `HF_FLOW_DEBUG`; it runs for every request and captures tools, response schema, sampling controls, etc. Use this log to verify per-model overrides and other request options at runtime.