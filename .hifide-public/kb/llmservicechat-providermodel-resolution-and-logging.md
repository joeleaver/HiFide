---
id: 61047692-e68d-4e35-b4cc-e7aa12ee728e
title: LLMService.chat provider/model resolution and logging
tags: [llm, provider, model, flow, llm-service, design]
files: [electron/flow-engine/llm-service.ts]
createdAt: 2025-12-02T23:05:24.627Z
updatedAt: 2025-12-02T23:05:24.627Z
---

Tracks design decisions for provider/model resolution inside LLMService.chat, including use of effectiveProvider/effectiveModel in all logging and event emission paths to avoid ReferenceError and ensure consistent telemetry.