
export type WorkspaceId = string

export const SEARCH_NOTIFICATION_RESULTS = 'search.workspace.results'
export const SEARCH_NOTIFICATION_DONE = 'search.workspace.done'

export interface WorkspaceSearchParams {
  query: string
  replace?: string
  isRegex?: boolean
  matchCase?: boolean
  matchWholeWord?: boolean
  includeGlobs?: string[]
  excludeGlobs?: string[]
  useIgnoreFiles?: boolean
  useGlobalIgnore?: boolean
  maxResults?: number
}

export interface WorkspaceSearchPosition {
  line: number
  column: number
}

export interface WorkspaceSearchMatch {
  id: string
  path: string
  relativePath: string
  line: number
  column: number
  matchText: string
  lineText: string
  range: {
    start: WorkspaceSearchPosition
    end: WorkspaceSearchPosition
  }
  captureTexts?: string[]
}

export interface WorkspaceSearchFileResult {
  path: string
  relativePath: string
  matches: WorkspaceSearchMatch[]
}

export interface WorkspaceSearchBatchPayload {
  searchId: string
  workspaceRoot: WorkspaceId
  files: WorkspaceSearchFileResult[]
  matchCount: number
  fileCount: number
}

export interface WorkspaceSearchDonePayload {
  searchId: string
  workspaceRoot: WorkspaceId
  matchCount: number
  fileCount: number
  durationMs: number
  cancelled: boolean
  limitHit: boolean
  error?: string | null
}

export interface WorkspaceReplaceMatch {
  id?: string
  start: WorkspaceSearchPosition
  end: WorkspaceSearchPosition
  replacement: string
}

export interface WorkspaceReplaceOperation {
  path: string
  matches: WorkspaceReplaceMatch[]
}

export interface WorkspaceReplaceRequest {
  searchId?: string | null
  operations: WorkspaceReplaceOperation[]
}

export interface WorkspaceReplaceResponse {
  updatedFiles: string[]
  replacementsApplied: number
}
