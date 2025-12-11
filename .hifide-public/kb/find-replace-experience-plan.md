---
id: 9d54b109-6704-4c83-992d-77e3fb9151d2
title: Find & replace experience plan
tags: [editor, search, planning]
files: []
createdAt: 2025-12-09T18:31:20.242Z
updatedAt: 2025-12-09T18:35:13.327Z
---

## Overview
Workspace-wide find/replace plan aligned with the Explorer architecture. In-file search/replace shipped on 2025-12-09 (renderer controller + Monaco bindings), so this doc now focuses on the remaining workspace search effort.

## Completed: In-file find & replace
- **Implementation**: Renderer-side controller wraps Monaco’s widget/shortcuts (Ctrl/Cmd+F, Ctrl/Cmd+H, F3, Shift+F3) so every tab shares consistent state.
- **MDX parity**: Markdown mode delegates to mdxeditor’s search API; Source mode reuses Monaco, keeping both views synchronized.
- **Commands**: Command palette + menu entries trigger store actions to match VSCode ergonomics.

## Workspace find & replace
- **Backend RPC**: Add `search.workspace` (ripgrep-backed) scoped to the active workspace with streaming batches to keep the UI responsive.
- **Results model**: Renderer store tracks the current query, filters (globs, case, regex), and result tree (file → matches). Support multi-select replace via `search.workspace.apply` RPC that edits files server-side and emits watcher events.
- **UI**: Build a collapsible panel (VSCode-style) alongside the explorer/open-files panes. Show per-file match counts, preview lines, and include replace inputs.
- **Performance**: Throttle requests, cancel in-flight searches on query changes, and bubble ripgrep errors through toasts.

## Integration steps
1. Implement the workspace search panel + renderer store for queries, filters, and results.
2. Wire backend RPC endpoints, ripgrep process management, and watcher-triggered editor reloads after bulk replace.
3. Polish UX (loading states, keyboard shortcuts, highlighting) and document extension points for future language-aware search.