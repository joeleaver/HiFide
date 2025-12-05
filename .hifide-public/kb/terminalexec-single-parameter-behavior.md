---
id: f398d312-c4ff-4f9e-9ac7-88699b5eba6d
title: terminalExec single-parameter behavior
tags: [terminal, tools, documentation]
files: [electron/tools/terminal/exec.ts, electron/tools/terminal/sessionCommandOutput.ts, README.md]
createdAt: 2025-12-05T01:04:07.321Z
updatedAt: 2025-12-05T01:04:07.321Z
---

- `terminalExec` now accepts only a `command` parameter. Timeout, idle polling, and output limits are internal constants (60s wait, 500-line cap).
- The tool blocks for up to 60 seconds or until the command exits. If the command completes within that window and produces <=500 lines, the entire sanitized log is returned.
- When the output exceeds 500 lines or the command is still running after 60 seconds, the tool returns the message `Command is long running and still in progress, use terminalSessionCommandOutput to see current state`, plus a 500-line preview and a `commandId` for follow-up paging.
- Use `terminalSessionCommandOutput` with the provided `commandId` (and optional `offset`/`maxBytes`) to fetch the remaining log. The tool description documents this continuation workflow.
- README’s Terminal section documents the single-parameter contract and long-running behavior so agents understand the flow.
