---
id: b1130498-693c-4c97-87df-5f7bde52029f
title: LLM service agentStream logging
tags: [llm, logging, mcp]
files: [electron/flow-engine/llm-service.ts]
createdAt: 2025-12-11T05:13:42.342Z
updatedAt: 2025-12-11T05:13:42.342Z
---

### Overview
`electron/flow-engine/llm-service.ts` now logs each provider invocation using `util.inspect` so the console output includes the full `tools` array that will be passed to the LLM.

### Details
- Imports `inspect` from Node's `util` module near the top of `llm-service.ts`.
- When constructing `agentStreamConfig`, the sanitized config (with the API key removed) is wrapped in a `logPayload` object `{ provider, model, config }`.
- The log statement now calls `inspect(logPayload, { depth: null, maxArrayLength: null, breakLength: 120, colors: false })` before passing it to `console.log('[llm-service] agentStream config', …)` to ensure nested structures such as MCP tool definitions are fully expanded instead of appearing as `[Object]`.
- This makes it easy to confirm which tool definitions the LLM receives, especially when debugging MCP all-or-nothing synchronization.
