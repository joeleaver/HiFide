import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GitRefKind = 'head' | 'tag' | 'remote'

export interface GitRef {
  kind: GitRefKind
  name: string
  sha: string
}

const REF_FIELD_SEP = '\t'

export function parseForEachRefOutput(stdout: string, kind: GitRefKind): GitRef[] {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const refs: GitRef[] = []

  for (const line of lines) {
    const [sha, name] = line.split(REF_FIELD_SEP)
    if (!sha || !name) continue
    refs.push({ kind, sha, name })
  }

  return refs
}

export async function getHeadSha(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    })
    const sha = stdout.trim()
    return sha || null
  } catch {
    return null
  }
}

export async function getRefs(repoRoot: string, opts: { includeRemotes?: boolean } = {}): Promise<GitRef[]> {
  const includeRemotes = !!opts.includeRemotes

  const tasks: Array<Promise<GitRef[]>> = []

  // Local branches
  tasks.push(
    execFileAsync('git', ['for-each-ref', '--format=%(objectname)\t%(refname:short)', 'refs/heads'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 4,
    }).then(({ stdout }) => parseForEachRefOutput(stdout, 'head'))
  )

  // Tags
  tasks.push(
    execFileAsync('git', ['for-each-ref', '--format=%(objectname)\t%(refname:short)', 'refs/tags'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 4,
    }).then(({ stdout }) => parseForEachRefOutput(stdout, 'tag'))
  )

  if (includeRemotes) {
    tasks.push(
      execFileAsync('git', ['for-each-ref', '--format=%(objectname)\t%(refname:short)', 'refs/remotes'], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024 * 4,
      }).then(({ stdout }) => parseForEachRefOutput(stdout, 'remote'))
    )
  }

  const results = await Promise.allSettled(tasks)
  const refs: GitRef[] = []

  for (const r of results) {
    if (r.status === 'fulfilled') refs.push(...r.value)
  }

  return refs
}

export function buildShaToDecorations(refs: GitRef[], headSha: string | null): Map<string, string[]> {
  const map = new Map<string, string[]>()

  for (const ref of refs) {
    const label = ref.kind === 'tag' ? `tag:${ref.name}` : ref.name
    const arr = map.get(ref.sha) ?? []
    arr.push(label)
    map.set(ref.sha, arr)
  }

  if (headSha) {
    const arr = map.get(headSha) ?? []
    if (!arr.includes('HEAD')) arr.unshift('HEAD')
    map.set(headSha, arr)
  }

  // Deterministic order: HEAD first (already), then lexicographic
  for (const [sha, labels] of map.entries()) {
    const headFirst = labels[0] === 'HEAD' ? ['HEAD'] : []
    const rest = labels.filter((l) => l !== 'HEAD').sort((a, b) => a.localeCompare(b))
    map.set(sha, [...headFirst, ...rest])
  }

  return map
}
