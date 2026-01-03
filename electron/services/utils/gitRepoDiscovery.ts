import path from 'node:path'
import fs from 'node:fs/promises'
import type { GitRepoInfo } from '../../../shared/gitRepos.js'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function normalize(p: string): string {
  try {
    return path.resolve(p)
  } catch {
    return p
  }
}

function isIgnoredDirName(name: string): boolean {
  return name === 'node_modules' || name === '.git' || name.startsWith('.hifide-')
}

async function isGitRoot(dir: string): Promise<boolean> {
  // v1: treat `.git` directory or file as repo marker
  return exists(path.join(dir, '.git'))
}

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function discoverGitRepos(workspaceRoot: string, opts: { maxDepth?: number } = {}): Promise<GitRepoInfo[]> {
  const maxDepth = opts.maxDepth ?? 4
  const root = normalize(workspaceRoot)

  const found = new Set<string>()
  const repos: GitRepoInfo[] = []

  const pushRepo = (repoRoot: string) => {
    const normalized = normalize(repoRoot)
    if (found.has(normalized)) return
    found.add(normalized)
    repos.push({ repoRoot: normalized, name: path.basename(normalized) || normalized })
  }

  // Include workspace root if it's a git repo
  if (await isGitRoot(root)) {
    pushRepo(root)
  }

  // DFS bounded depth
  type QueueItem = { dir: string; depth: number }
  const queue: QueueItem[] = [{ dir: root, depth: 0 }]

  while (queue.length) {
    const item = queue.pop()!
    if (item.depth >= maxDepth) continue

    const subdirs = await listSubdirs(item.dir)
    for (const name of subdirs) {
      if (isIgnoredDirName(name)) continue
      const child = path.join(item.dir, name)

      if (await isGitRoot(child)) {
        pushRepo(child)
        // still keep walking; nested repos can exist
      }

      queue.push({ dir: child, depth: item.depth + 1 })
    }
  }

  // Stable ordering
  repos.sort((a, b) => a.repoRoot.localeCompare(b.repoRoot))
  return repos
}
