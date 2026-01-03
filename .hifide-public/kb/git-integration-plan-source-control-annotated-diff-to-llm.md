---
id: a2701f97-f8ed-4c58-82f5-81f844d81cf4
title: Git Integration plan: Source Control + annotated diff-to-LLM
tags: [git, source-control, history, diff, architecture]
files: [electron/services/GitLogService.ts, electron/services/GitCommitService.ts, electron/services/GitDiffService.ts, src/store/sourceControl.ts, src/components/SourceControlView.tsx, src/components/sourceControl/HistoryView.tsx, src/components/sourceControl/CommitDetailsView.tsx, shared/gitLog.ts, shared/gitCommit.ts]
createdAt: 2025-12-16T03:35:40.542Z
updatedAt: 2026-01-03T03:53:43.858Z
---

# Git Integration: commit graph / log view (v1)

## Implementation Details

### Backend
- **GitLogService**: Provides paginated git log with parent SHAs and ref decorations (branches, tags).
- **GitCommitService**: Provides full commit metadata and list of changed files.
- **GitDiffService**: Enhanced with `getCommitDiff` to provide `GitFileDiff` for any file in any commit using `git show`.

### Frontend
- **HistoryView**: Displays the commit log with a deterministic commit graph (v1). Shows SHAs, subjects, authors, dates, and ref decorations.
- **CommitDetailsView**: Displays selected commit details (subject, body, author, committer).
  - Includes a file list with status indicators (implicitly by path for now).
  - **Integrated Diff Viewer**: Selecting a file in the commit details view loads and displays its diff using the same `DiffViewer` component used for the working tree.
- **SourceControlStore**: 
  - Tracks `history` (commits, cursor, busy/error state).
  - Tracks `commitDetails` and `commitDiffsByPath` for the selected commit.
  - Automatically fetches the first file's diff when a commit is selected.

### Architecture
- The system uses a side-by-side layout for history: the list on the left, and the detail panel on the right.
- Unified shared types (`GitLogCommit`, `GitCommitDetails`, `GitFileDiff`) ensure consistency between Electron and React.
