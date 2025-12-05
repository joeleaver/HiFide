---
id: fadefc09-0a58-47a9-8804-2c51f5273295
title: terminalExec prompt detection
tags: [terminal, tools, prompt-detection]
files: [electron/tools/terminal/exec.ts, electron/__tests__/tools/terminalExec.prompt.test.ts]
createdAt: 2025-12-05T16:35:54.462Z
updatedAt: 2025-12-05T16:53:59.285Z
---

`terminalExec` now records both the literal prompt snapshot and a derived "prompt signature" that strips ANSI/status glyphs and normalizes tokens (paths, branch names, etc.). When waiting for completion we consider a command finished if either the raw snapshot returns *or* the new signature matches the latest prompt line, which lets us handle shells that render different glyphs (✗/✘/❯/➜) after non-zero exits. The fallback regex list was also expanded to include common Unicode prompt symbols so we still detect completion even when no prior snapshot exists. Relevant code: `electron/tools/terminal/exec.ts` (helpers `getPromptSnapshot`, `buildPromptSignature`, and `hasPromptReturned`) plus regression tests in `electron/__tests__/tools/terminalExec.prompt.test.ts`.