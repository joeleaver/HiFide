---
id: d6c86e94-c52c-4cb7-8cfb-0beaa6ce8dd9
title: workspaceSearch badge & payload visibility policy
tags: [workspaceSearch, badges, tooling]
files: [electron/tools/workspace/searchWorkspace.ts, electron/flow-engine/badge-processor.ts, src/components/BadgeWorkspaceSearchContent.tsx, src/components/session/Badge/BadgeContent.tsx, src/components/session/Badge/inferContentType.ts, src/components/session/Badge/__tests__/BadgeContent.test.ts]
createdAt: 2025-12-11T23:01:10.688Z
updatedAt: 2025-12-12T20:25:07.149Z
---

## Workspace search tooling
- Tool pipeline remains three-phase: ripgrep -> file-path search -> tokenized fallback, exposing the selected mode via `meta.mode`.
- The minimal payload returned to language models omits `previewKey`; only the UX layer may request cached previews via `tool.getResult`.
- Timeline badges now always render the minimal payload directly in `BadgeWorkspaceSearchContent`, with the richer cached preview shown when available.
- Badge viewer selection no longer depends on the engine populating `contentType`; `inferContentType` now normalizes tool names (e.g., `workspaceSearch`/`searchWorkspace`) so workspace-search badges always display the dedicated viewer.

## Relevant files
- `electron/tools/workspace/searchWorkspace.ts`
- `electron/flow-engine/badge-processor.ts`
- `src/components/BadgeWorkspaceSearchContent.tsx`
- `src/components/session/Badge/BadgeContent.tsx`
- `src/components/session/Badge/inferContentType.ts`
- `src/components/session/Badge/__tests__/BadgeContent.test.ts`
