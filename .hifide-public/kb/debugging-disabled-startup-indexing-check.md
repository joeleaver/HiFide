---
id: bc55aef5-1abe-440a-a380-2512d24725a7
title: Debugging: Disabled Startup Indexing Check
tags: [indexing, debug, orchestrator]
files: [electron/services/vector/IndexOrchestratorService.ts]
createdAt: 2026-01-04T05:16:19.055Z
updatedAt: 2026-01-04T05:16:19.055Z
---

For debugging the code indexing discovery hang, the startup index validation in `IndexOrchestratorService` has been temporarily disabled by forcing the condition to `false`. This prevents automatic `indexAll()` triggers on startup, allowing us to isolate if the hang is related to the initial validation or the subsequent discovery process in the worker threads.

File: `electron/services/vector/IndexOrchestratorService.ts`
Change: Modified `runStartupCheck` to skip `this.indexAll()` even if indexes are missing or empty.