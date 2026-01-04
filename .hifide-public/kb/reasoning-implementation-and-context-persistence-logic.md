---
id: 7305761e-7555-41ed-8731-c157bca72770
title: Reasoning implementation and context persistence logic
tags: [llm, reasoning, context, gemini, openrouter, thinking]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/llm/payloads.ts, electron/providers-ai-sdk/gemini.ts, electron/providers-ai-sdk/openrouter.ts]
createdAt: 2025-12-02T23:30:20.708Z
updatedAt: 2026-01-03T23:40:51.295Z
---

# Reasoning Implementation and Context Persistence

This article outlines how "reasoning" (thinking/thought) data is handled across different providers and persisted in the conversation.

## Provider-Specific Extraction

1.  **Google (Gemini):** Uses top-level `includeThoughts` and follows native Google AI SDK patterns.
2.  **OpenRouter:** Uses the `extractReasoningMiddleware` to pull content between `<think>` tags. Some models on OpenRouter may return reasoning as an object (especially during step-by-step agent turns).

## Sanitization Logic

To prevent context poisoning or UI corruption (e.g., "[object Object]" appearing in the chat), reasoning is sanitized at two points:

- **UI Timeline (`src/store/chatTimeline.ts`):** The `appendReasoning` method checks if the incoming `text` is an object. If so, it extracts `.text` or `.content` before stringifying.
- **Message History (`electron/flow-engine/llm-service.ts`):** When `onStep` returns reasoning, `LLMService` ensures the `assistantMessage.reasoning` property is a primitive string before adding it to the `ContextManager`.

## Context Re-injection

When sending history back to a provider:
- **OpenAI-Compatible (including OpenRouter):** Re-injects reasoning by wrapping it in `<think>` tags at the start of the assistant message content. This helps the model maintain its "train of thought."
- **Gemini:** Re-injects reasoning as a specific text part at the start of the model's message object.

## Metadata Tracking

Reasoning tokens are tracked separately in the `usage_breakdown` event and displayed in the **Tokens & Costs Panel** as "thinking" tokens.
