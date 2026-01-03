---
id: a2701f97-f8ed-4c58-82f5-81f844d81cf4
title: Git Integration plan: Source Control + annotated diff-to-LLM
tags: [git, source-control, llm, diff, annotations, architecture, zustand, history]
files: [src/store/sourceControl.ts, src/components/SourceControlView.tsx, src/components/sourceControl/HistoryView.tsx, src/components/sourceControl/CommitDetailsView.tsx, electron/backend/ws/handlers/ui-handlers.ts, electron/services/GitCommitService.ts, shared/gitCommit.ts, electron/services/GitLogService.ts, src/store/sourceControl/commitGraph.ts, src/store/sourceControl/__tests__/commitGraph.test.ts]
createdAt: 2025-12-16T03:35:40.542Z
updatedAt: 2025-12-16T17:22:17.169Z
---

# Git Integration plan: Source Control + annotated diff-to-LLM

## Scope (v1)
- Repositories (discover/select)
- Changed files (status, staged/unstaged)
- Diff viewer + annotations (line + hunk)
- Commit (message + stage/unstage)
- History tab: commit list + commit details
- **History decorations**: local + remote branches, tags, HEAD
- **History graph lanes**: renderer-side lane assignment + compact graph column

## Architecture constraints
- **No `useEffect` and no business logic in React components.**
- Orchestration lives in Zustand stores and backend services.

## Diff annotations → LLM context
(unchanged)

## History API (implemented)
### `git.getLog`
- Input: `{ repoRoot, limit, cursor? }`
- Output: `{ commits: GitLogCommit[], nextCursor }`
- Each `GitLogCommit` includes:
  - `sha`, `parents[]`, `authorName`, `authorEmail`, `authorDateIso`, `subject`, `body`
  - `refs?: string[]` decorations including:
    - `HEAD`
    - local branches (`main`)
    - **remote branches** (`origin/main`)
    - tags (`tag:v1.2.3`)

### `git.getCommitDetails`
- Input: `{ repoRoot, sha }`
- Output: metadata + file list

## History Graph (v1 implemented)
- We are not depending on VSCode internal graph code.
- Renderer-side lane assignment is computed from `parents[]`.
- Current rendering:
  - A compact **graph column** is rendered next to each commit row.
  - It renders:
    - commit nodes
    - **best-effort connector lines** (vertical continuity + merge diagonals) within the loaded window
- Limitations:
  - Connectors are deterministic for the loaded window but do not provide cross-page continuity.
  - Paging: lanes may change if the loaded window changes.

## Follow-up tasks
- Improve connector accuracy + lane stability when paging (tracked on Kanban).

## Files
- `electron/services/GitLogService.ts`
- `electron/services/utils/gitRefs.ts`
- `src/components/sourceControl/HistoryView.tsx`
- `src/store/sourceControl.ts`
- `src/store/sourceControl/commitGraph.ts`
