---
id: 5405130a-5372-4011-aff9-b7e9928852dd
title: LLM user message deduplication
tags: [llm, context, history, bugfix]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/__tests__/llmService.message-history.test.ts]
createdAt: 2025-12-11T21:22:13.513Z
updatedAt: 2025-12-11T21:24:16.636Z
---

LLM user message duplication stemmed from both `userInput`/`manualInput` nodes and `llm-service` appending the same message to `MainFlowContext`. The fix adds a normalization helper inside `electron/flow-engine/llm-service.ts` that trims the pending text, inspects the latest history entry, and only calls `contextManager.addMessage` when the last message isn’t already the same trimmed `role: 'user'` content. This preserves legitimate repeated prompts (because after each round the history ends with an assistant response) while preventing immediate duplicates caused by upstream nodes.

Tests: `electron/flow-engine/__tests__/llmService.message-history.test.ts` exercises both the “message already appended” and “message absent” paths against the mock provider to ensure history stays aligned.
