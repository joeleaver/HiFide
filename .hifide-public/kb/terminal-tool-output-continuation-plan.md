---
id: bf2dbf88-b5db-40b7-ba6c-4c6e9341c1af
title: Terminal tool output continuation plan
tags: [terminal, tooling, implementation]
files: [electron/tools/terminal/exec.ts, electron/tools/terminal/sessionCommandOutput.ts, electron/tools/index.ts, electron/services/ToolsService.ts, README.md]
createdAt: 2025-12-05T00:49:02.923Z
updatedAt: 2025-12-05T00:51:35.188Z
---

Terminal tooling now supports explicit continuations for long logs.

Key pieces:
- `terminalExec` (electron/tools/terminal/exec.ts) tracks the active command, reports the chunk range (`rangeStart`/`rangeEnd`), `commandId`, `commandFinished`, and emits a `continuationHint` when more data exists (earlier or later). The hint tells the agent to call `terminalSessionCommandOutput` with the provided `commandId`, `nextOffset`, and optional `rewindOffset`.
- New agent tool `terminalSessionCommandOutput` (electron/tools/terminal/sessionCommandOutput.ts) pages through captured PTY output for a prior command using `{ commandId, offset, maxBytes }`, returning the chunk plus metadata (`hasMoreBefore/After`, `commandComplete`).
- Tool registry (`electron/tools/index.ts`) and category map (`electron/services/ToolsService.ts`) include the new tool, and README documents the continuation behavior for long terminal logs.

LLMs no longer need to guess about `sessionTail`; they receive a structured next step and deterministic paging for any command output held in the agent PTY buffers.