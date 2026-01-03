export interface GitLogCommit {
  sha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDateIso: string
  subject: string
  body: string
  refs?: string[]
}

export interface GitLogPage {
  commits: GitLogCommit[]
  nextCursor?: string | null
}
