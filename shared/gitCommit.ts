export type GitCommitDetails = {
  sha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDateIso: string
  committerName: string
  committerEmail: string
  committerDateIso: string
  subject: string
  body: string
  files: string[]
}

