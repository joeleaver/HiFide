import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { GitCommitDetails } from '../../shared/gitCommit'

const execFileAsync = promisify(execFile)

const RECORD_SEP = '\u001e' // RS
const FIELD_SEP = '\u001f' // US

function safeSplit(input: string, sep: string): string[] {
  if (!input) return []
  return input.split(sep)
}

function parseShowOutput(stdout: string): Omit<GitCommitDetails, 'sha' | 'files'> {
  const trimmed = stdout.trim()
  const fields = safeSplit(trimmed, FIELD_SEP)

  // Keep in sync with buildShowArgs
  const [parentsStr, authorName, authorEmail, authorDateIso, committerName, committerEmail, committerDateIso, subject, body] = fields

  return {
    parents: (parentsStr ?? '').trim() ? (parentsStr ?? '').trim().split(' ') : [],
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    authorDateIso: authorDateIso ?? '',
    committerName: committerName ?? '',
    committerEmail: committerEmail ?? '',
    committerDateIso: committerDateIso ?? '',
    subject: subject ?? '',
    body: body ?? '',
  }
}

function parseNameOnly(stdout: string): string[] {
  return stdout
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildShowArgs(sha: string): string[] {
  // parents | author | committer | subject | body
  const pretty = [
    '%P',
    '%an',
    '%ae',
    '%aI',
    '%cn',
    '%ce',
    '%cI',
    '%s',
    '%b',
  ].join(FIELD_SEP)

  return ['show', '--quiet', `--pretty=format:${pretty}${RECORD_SEP}`, sha]
}

export class GitCommitService {
  async getCommitDetails(repoRoot: string, sha: string): Promise<GitCommitDetails> {
    if (!sha) throw new Error('sha-required')

    const [{ stdout: showStdout }, { stdout: filesStdout }] = await Promise.all([
      execFileAsync('git', buildShowArgs(sha), { cwd: repoRoot, maxBuffer: 1024 * 1024 * 4 }),
      execFileAsync('git', ['show', '--name-only', '--pretty=format:', sha], { cwd: repoRoot, maxBuffer: 1024 * 1024 * 8 }),
    ])

    const meta = parseShowOutput(showStdout.replace(RECORD_SEP, ''))
    const files = parseNameOnly(filesStdout)

    return {
      sha,
      files,
      ...meta,
    }
  }
}

