---
id: dd813344-4dfc-4a99-8d40-85b09e9365f3
title: Tool badge audit & redesign plan (expandable, consistent titles, reusable components)
tags: [badges, tools, ui, architecture, kb, kanban, fs, mcp]
files: [electron/flow-engine/badge-processor.ts, src/components/session/Badge/BadgeContent.tsx, src/components/session/Badge/inferContentType.ts, src/components/session/Badge/viewers/OperationResultViewer.tsx, src/components/session/Badge/components/BadgePill.tsx, src/components/session/Badge/BadgeHeader.tsx]
createdAt: 2025-12-15T18:31:32.997Z
updatedAt: 2025-12-15T19:40:52.152Z
---

## Goal
Standardize tool execution badges so they are consistent, expandable-by-default, and have informative titles.

Key UX requirements:
- Most tool badges are expandable by default.
- Badge header title shows:
  - parameter highlights (for param-based tools)
  - file names for file-affecting tools
  - line numbers or +/- line counts for line-affecting tools
- Consistent look and feel (applyEdits is the gold standard).
- Reusable, composable components.
- No dead badge code.

## Standard expandable payload (v1)
We store a normalized payload in `badge.metadata.fullParams` so viewers can render consistently.

Shape (conceptual):
- `inputs`: original tool args (sanitized)
- `effects`: best-effort list of effects (files read/written/moved/deleted, line ranges, etc.)
- `outputs`: summarized outputs + raw tool result
- `diagnostics`: timing, exit codes, errors, counts

Implemented by `buildToolPayload(badge)` in `electron/flow-engine/badge-processor.ts`.

Viewer:
- `contentType: 'operation-result'` routes to `OperationResultViewer` (currently summary + JSON fallback).

## Current implementation status
- FS tools: standardized, expandable-by-default, `operation-result`
- Kanban tools: standardized, expandable-by-default, `operation-result`
- KB store/delete: standardized, expandable-by-default, `operation-result`
- MCP tools: generic handling (no tool-specific configs). Title format: `MCP <server>: <tool> …` and routes to `operation-result`

## Dead-code / routing cleanup
- `workspace-jump` now routes to `WorkspaceJumpViewer` (was incorrectly routed to `WorkspaceSearchViewer`).
- Removed unused content type `text-search` (Text Grep now uses `contentType: 'search'`).
- Added inference for MCP tools (`mcp_*` -> `operation-result`) to avoid regressions.

## Key files
- `electron/flow-engine/badge-processor.ts` (server-side badge config + payload builder)
- `electron/store/types.ts` (BadgeContentType)
- `src/components/session/Badge/BadgeHeader.tsx` (header UI, applyEdits gold standard)
- `src/components/session/Badge/components/BadgePill.tsx` (shared pill UI)
- `src/components/session/Badge/BadgeContent.tsx` (viewer dispatcher)
- `src/components/session/Badge/viewers/OperationResultViewer.tsx`
- `src/components/session/Badge/inferContentType.ts`

## Next steps
- Convert remaining first-party tools (terminalExec, workspaceSearch, knowledgeBaseSearch, workspaceMap) to `operation-result` with standard payload, while preserving specialized viewers as optional (or by making OperationResultViewer smart enough to render “search results” blocks).
- Add a registry/test ensuring every `BadgeContentType` has a corresponding viewer route (compile-time or unit test).
