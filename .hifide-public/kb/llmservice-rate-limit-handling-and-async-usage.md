---
id: 8b588c88-1770-417d-b8fd-9d09e412f073
title: LLMService rate limit handling and async usage
tags: [llm-service, rate-limit, async, llm, flow-engine]
files: [electron/flow-engine/llm-service.ts]
createdAt: 2025-12-02T22:52:02.697Z
updatedAt: 2025-12-02T22:52:02.697Z
---

The llmService.chat method in electron/flow-engine/llm-service.ts is defined as an async function and is responsible for orchestrating LLM requests, including proactive rate limiting.

Key points:
- chat(request: LMServiceRequest) is declared async and returns a Promise<LLMServiceResponse>.
- Before constructing the streaming provider call, chat performs a proactive rate-limit check using rateLimitTracker.checkAndWait(provider, model).
- This call must be awaited inside chat so that the engine can pause before issuing the provider request when nearing rate limits.
- After any wait, chat records the request via rateLimitTracker.recordRequest(provider, model).
- Callers of llmService.chat (e.g., llmRequest.ts, intentRouter.ts) must await the returned promise.

Any additional await usage inside llm-service.ts must be contained within async functions (chat itself or nested async callbacks used for streaming). When introducing new awaits near the rate limit logic, verify the containing function/method is async to avoid build-time errors from Vite/Esbuild ("await can only be used inside an async function").