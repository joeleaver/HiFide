import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildShaToDecorations, getHeadSha, getRefs } from './utils/gitRefs'

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
  /** When present, pass back as cursor to fetch next page. */
  nextCursor?: string | null
}

const execFileAsync = promisify(execFile)

const RECORD_SEP = '\u001e' // RS
const FIELD_SEP = '\u001f' // US

function safeSplit(input: string, sep: string): string[] {
  if (!input) return []
  return input.split(sep)
}

function parseGitLogOutput(stdout: string): GitLogCommit[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []

  const records = safeSplit(trimmed, RECORD_SEP)
  const commits: GitLogCommit[] = []

  for (const record of records) {
    if (!record) continue
    const fields = safeSplit(record, FIELD_SEP)
    // Keep format in sync with buildGitLogArgs
    const [sha, parentsStr, authorName, authorEmail, authorDateIso, subject, body] = fields
    if (!sha) continue

    commits.push({
      sha,
      parents: (parentsStr ?? '').trim() ? (parentsStr ?? '').trim().split(' ') : [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorDateIso: authorDateIso ?? '',
      subject: subject ?? '',
      body: body ?? '',
    })
  }

  return commits
}

function buildGitLogArgs(params: { limit: number; cursor?: string | null }): string[] {
  const limit = Math.max(1, Math.min(200, params.limit || 50))
  const args: string[] = ['log', `-${limit}`]

  // Cursor: fetch commits older than (strictly before) the cursor sha.
  // We use <sha>^..HEAD for newer; for older paging we use --skip is brittle.
  // v1 simple approach: use --max-count and --skip with an integer cursor.
  // However we don't have a stable skip count across history changes.
  // So v1 cursor is a sha and we use "<sha>^" as the starting point.
  if (params.cursor) {
    args.push(`${params.cursor}^`)
  }

  // Format fields: sha | parents | author name | author email | author date iso | subject | body
  const pretty = [
    '%H',
    '%P',
    '%an',
    '%ae',
    '%aI',
    '%s',
    '%b',
  ].join(FIELD_SEP)
  args.push(`--pretty=format:${pretty}${RECORD_SEP}`)

  return args
}

export class GitLogService {
  async getLog(repoRoot: string, opts: { limit?: number; cursor?: string | null } = {}): Promise<GitLogPage> {
    const limit = opts.limit ?? 50

    const { stdout } = await execFileAsync('git', buildGitLogArgs({ limit, cursor: opts.cursor ?? null }), {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 8,
    })

    const commits = parseGitLogOutput(stdout)

    // Decorate with refs (v1: include local + remote branches, tags, and HEAD)
    try {
      const [refs, headSha] = await Promise.all([
        getRefs(repoRoot, { includeRemotes: true }),
        getHeadSha(repoRoot),
      ])
      const map = buildShaToDecorations(refs, headSha)
      for (const c of commits) {
        const decorations = map.get(c.sha)
        if (decorations && decorations.length) c.refs = decorations
      }
    } catch {
      // Non-fatal: history still works without decorations.
    }
    const nextCursor = commits.length > 0 ? commits[commits.length - 1]!.sha : null

    return { commits, nextCursor }
  }
}
