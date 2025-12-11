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
