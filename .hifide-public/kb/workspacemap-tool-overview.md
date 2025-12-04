---
id: daa7bd76-ccf1-45cc-b40a-f65dc4f3683e
title: workspaceMap tool overview
tags: [tools, workspaceMap, agent]
files: []
createdAt: 2025-12-03T22:00:11.816Z
updatedAt: 2025-12-03T22:00:11.816Z
---

## Purpose
`workspaceMap` is an orientation helper for the coding agents. It produces a compact map of the repository so an LLM can understand the code layout without running multiple searches.

## Behavior
- **Inputs:** Optional `maxPerSection` (default 12), `mode` (`basic` or `enriched`, default `enriched`), and `timeBudgetMs` (soft limit for the enriched passes, default ~10s, minimum 150ms).
- **Common ignores:** Matches the major directories skipped by `workspaceSearch` (node_modules, dist, build, .git, .hifide-* etc.).
- **Core sections:**
  - Renderer (`src`), Main/Electron (`electron`), and `packages/` if present. Each section lists representative files (ts/tsx/js/json) plus a `handle`/line range stub so downstream tools can open the file quickly.
  - "Key Electron files" (main.ts, app.ts, window.ts, store/index, tools registry, IPC registry, services, AI providers) filtered to existing files.
  - "Key Renderer files" discovered heuristically (app.tsx, zustand/store files) from `src/`.
  - Stores & slices (`electron/store/index` + files under `electron/store/slices/**`).
  - IPC handler files, agent tool files.
- **Enriched mode additions:** While budget allows, runs curated ripgrep scans via `grepTool` to surface “Landmarks” sections:
  - IPC (`ipcMain.handle` invocations)
  - App lifecycle (`app.whenReady`, `new BrowserWindow`)
  - Preload bridges (`contextBridge.exposeInMainWorld`)
  - Store helpers (`create*Slice`, `persist` calls)
  - Provider/adapters under `electron/providers/**`
- **Example queries:** Returns a static list of recommended follow-up `workspaceSearch` queries.

## Output structure
`{ ok, data: { root, sections[], exampleQueries[], meta { elapsedMs, mode } } }` where each section contains `title` and `items` with `path`, `handle`, `lines`, and optional `why`.

## Files
- Implementation: `electron/tools/workspace/map.ts` (registered in `electron/tools/index.ts`, described in `electron/services/ToolsService.ts`).