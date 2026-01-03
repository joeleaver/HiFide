export type GitStatusCategory =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'ignored'
  | 'conflict'
  | 'clean'

export interface GitStatusEntry {
  /** Absolute filesystem path */
  path: string
  /** Workspace-relative path (POSIX separators) */
  relativePath: string
  /** Canonical status category */
  category: GitStatusCategory
  /** True if this change is in the index/staged area */
  staged: boolean
  /** True if this change is in the working tree */
  unstaged: boolean
  /** When category is renamed, original path (workspace relative) */
  renameFrom?: string | null
}

export interface GitStatusSnapshot {
  workspaceRoot: string
  generatedAt: number
  isRepo: boolean
  entries: GitStatusEntry[]
}

export const GIT_NOTIFICATION_STATUS = 'git.status'

export interface GitDiffLine {
  type: 'context' | 'add' | 'del'
  /** The raw line text without the leading diff prefix (+/-/space). */
  text: string
  /** Optional old/new line numbers (1-based). Missing for add/del appropriately. */
  oldLineNumber?: number
  newLineNumber?: number
}

export interface GitDiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: GitDiffLine[]
}

export interface GitFileDiff {
  repoRoot: string
  /** Workspace-relative path (POSIX separators). */
  relativePath: string
  /** Absolute path (best effort). */
  path: string
  staged: boolean
  hunks: GitDiffHunk[]
  /** True if git reports file as binary or diff could not be produced. */
  isBinary?: boolean
  /** For renames, if available. */
  renameFrom?: string | null
}
