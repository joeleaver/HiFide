---
id: b2366dd5-b640-47cc-9bb2-ea8a87cf2053
title: LLM tool hint injection
tags: [llm, tools, prompting]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/llm/payloads.ts, electron/flow-engine/__tests__/payloads.test.ts]
createdAt: 2025-12-11T05:46:25.213Z
updatedAt: 2025-12-11T20:45:09.276Z
---

Real-time tool hinting has been removed from the LLM service. `llm-service.ts` now forwards whatever `context.systemInstructions` already contains when formatting messages for OpenAI/Anthropic/Gemini, and the helper module `electron/flow-engine/llm/tool-hints.ts` was deleted. The payload helpers reverted to their original signatures (only OpenAI needs the provider hint for reasoning replay), and the Jest coverage under `electron/flow-engine/__tests__/payloads.test.ts` now just verifies that native system instructions flow through untouched. This ensures we are no longer mutating the developer prompt at runtime to work around tool visibility issues.