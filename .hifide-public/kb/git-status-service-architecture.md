---
id: f6fffd15-0f5d-4f06-baf5-a82394803e39
title: Git status service architecture
tags: [editor, git, explorer, architecture]
files: [electron/services/GitStatusService.ts, electron/services/utils/gitStatusParser.ts, electron/services/__tests__/gitStatusService.test.ts, shared/git.ts, src/store/explorer.ts]
createdAt: 2025-12-10T21:07:48.256Z
updatedAt: 2025-12-10T21:07:48.256Z
---

## Overview
`GitStatusService` provides a lightweight, read-only view of the current workspace’s Git working tree so the Explorer can surface VSCode-style decorations (modified folders, added/removed files, diagnostics). The service lives in the Electron main process and is started/stopped alongside `ExplorerService`, `LanguageServerService`, and other workspace-scoped services.

## Core responsibilities
- **Snapshotting:** Uses `git status --porcelain=v2 --branch` for fast discovery of tracked/untracked changes. Parsed output is normalized into `GitStatusSnapshot` objects keyed by workspace-relative paths (files and directories get separate entries so folder highlighting works).
- **Watching:** Subscribes to `.git/**/*` changes via chokidar; on relevant events it re-runs the status command and emits incremental updates. Rate-limited refreshes avoid thrashing on large repos.
- **Event delivery:** Publishes `git.status` updates over the websocket RPC/event layer. Renderers request the initial snapshot via `git.status` RPC and stay fresh through push notifications.
- **Lifecycle:** `WorkspaceManager` prepares the service during `attachWorkspace`, tears it down on detach, and routes events only when a Git repo exists (service gracefully no-ops otherwise).

## Renderer integration
- `useExplorerStore` caches git decorations from the snapshot and merges them with LSP diagnostics to colorize tree rows, Open Files, and tabs.
- Future Git features (commit panels, source control diff view) can reuse the same snapshot stream or extend the service with additional porcelain commands.

## Key files
- `electron/services/GitStatusService.ts`
- `electron/services/utils/gitStatusParser.ts`
- `electron/services/__tests__/gitStatusService.test.ts`
- `shared/git.ts`
- Renderer consumption in `src/store/explorer.ts`
