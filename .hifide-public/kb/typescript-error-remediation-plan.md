---
id: 074c4a8d-f8ad-4e0f-a689-2d04015d657f
title: TypeScript error remediation plan
tags: [typescript, build, workspace-search, editor, explorer]
files: []
createdAt: 2025-12-11T00:14:06.662Z
updatedAt: 2025-12-11T00:14:06.662Z
---

## Context
`pnpm exec tsc --noEmit` currently fails due to a handful of known issues discovered while refactoring the session panel width.

## Known errors (Nov 2025)
1. `electron/services/WorkspaceSearchService.ts`: `ChildProcessByStdio` is not assignable to the declared `ChildProcessWithoutNullStreams`. The service launches `ripgrep` through `spawn` and needs accurate typing for the returned process handle.
2. `shared/search.ts`: references `WorkspaceId` without importing/defining it after earlier refactors pulled the type from this module.
3. `src/components/explorer/WorkspaceSearchPane.tsx`: `ActionIcon` props no longer match Mantine’s v7 signature (`color` is now unioned and `radius` no longer accepts `string | number`).
4. `src/store/editor.ts`: the persisted state schema diverged from the live Zustand slice (removed `tabs`, renamed `activeTabId`, removed `isPreview`, etc.), so `persist` typing fails at compile time.

## Remediation plan
- Normalize the workspace search service typing by introducing a local `type WorkspaceSearchProcess = ChildProcessWithoutNullStreams` and ensuring `spawn` returns that type.
- Restore/define `WorkspaceId` in `shared/search.ts` (ideally import from the shared `types` barrel) and re-export anything consumed by renderer code.
- Update `WorkspaceSearchPane` button icons to use Mantine’s compatible props (`size`/`variant`, drop unsupported props).
- Align the editor store’s persisted state type with the actual slice shape (`tabState`, `activeTabId`, `previewTabId`, etc.) and ensure `zustand/middleware/persist` references the correct subset.

Once these fixes land, rerun `pnpm exec tsc --noEmit` followed by the project’s build step to verify a clean state.