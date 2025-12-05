---
id: 10663973-abba-4ae4-9770-a10d537c9b9e
title: Terminal exec early return and continuation workflow
tags: [terminal, tooling, docs]
files: [electron/tools/terminal/exec.ts, electron/tools/terminal/sessionCommandOutput.ts, README.md]
createdAt: 2025-12-05T00:56:10.213Z
updatedAt: 2025-12-05T00:56:10.213Z
---

- terminalExec now waits up to 60 seconds (or until output is idle for the configured window) before returning, reducing spurious early exits for slow commands. The timeout is still overridable via the `timeoutMs` parameter but clamps at 60s.
- The tool description explicitly mentions the early-return behavior and the continuation hint that references terminalSessionCommandOutput.
- terminalSessionCommandOutput’s description now emphasizes paging through buffered output via offsets/maxBytes after the early return.
- README Terminal tool section documents the 60s early-return rule and shows how to use terminalSessionCommandOutput for continuations.
- Relevant files: electron/tools/terminal/exec.ts, electron/tools/terminal/sessionCommandOutput.ts, README.md.
