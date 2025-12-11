import path from 'node:path'
import type { GitStatusEntry, GitStatusCategory } from '../../../shared/git.js'

export function parseGitStatusPorcelain(raw: string, workspaceRoot: string): GitStatusEntry[] {
  if (!raw) return []
  const tokens = raw.split('\u0000').filter((token) => token.length)
  const entries: GitStatusEntry[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    const record = tokens[i]
    if (!record || record.length < 3) continue

    const x = record[0]
    const y = record[1]
    const pathPart = record.slice(3)
    if (!pathPart) continue

    let relativePath = pathPart
    let renameFrom: string | null = null

    if (x === 'R' || x === 'C') {
      renameFrom = pathPart
      const newPath = tokens[i + 1]
      if (newPath) {
        relativePath = newPath
        i += 1
      }
    }

    const absolutePath = path.resolve(workspaceRoot, relativePath)
    const relativePosix = toPosixPath(path.relative(workspaceRoot, absolutePath)) || relativePath
    const category = deriveCategory(x, y)
    const staged = x !== ' ' && x !== '?' && x !== '!'
    const unstaged = y !== ' ' && y !== '?' && y !== '!'

    entries.push({
      path: absolutePath,
      relativePath: relativePosix,
      category,
      staged,
      unstaged,
      renameFrom,
    })
  }

  return entries
}

function deriveCategory(x: string, y: string): GitStatusCategory {
  if (x === '?' || y === '?') return 'untracked'
  if (x === '!' || y === '!') return 'ignored'
  if (x === 'U' || y === 'U') return 'conflict'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'A' || y === 'A' || x === 'C' || y === 'C') return 'added'
  if (x === 'M' || y === 'M') return 'modified'
  return 'modified'
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}
