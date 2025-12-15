---
id: 355341e7-f806-42bd-8de5-94653261914b
title: LLM tool hydration in llm-service
tags: [llm, tools, mcp, testing]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/__tests__/llmService.tool-hydration.test.ts, jest.config.cjs]
createdAt: 2025-12-11T21:12:57.442Z
updatedAt: 2025-12-11T21:12:57.442Z
---

The LLM service now hydrates tool descriptors from flow nodes before invoking providers. `llm-service.ts` imports `getAgentToolSnapshot` and resolves requested tool names into executable `AgentTool`s using the current `workspaceId`, logging any missing names. All downstream payloads (policy wrapper, request logging, usage accounting) use the hydrated list. Tests cover this behavior via `llmService.tool-hydration.test.ts`, and Jest maps `tools/agentToolRegistry.js` to the TS source using the new moduleNameMapper entry in `jest.config.cjs`.