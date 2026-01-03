import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Service } from './base/Service.js'
import type { GitFileDiff } from '../../shared/git.js'
import { parseUnifiedDiff } from './utils/gitDiffParser.js'

const execFileAsync = promisify(execFile)

interface WorkspaceDiffState {
  // v1: ephemeral; no persisted state
  lastError: string | null
}

interface GitDiffState {
  workspaces: Record<string, WorkspaceDiffState>
}

export class GitDiffService extends Service<GitDiffState> {
  constructor() {
    super({ workspaces: {} })
  }

  protected onStateChange(): void {
    // Git diff is transient - nothing to persist
  }

  private normalizeWorkspace(root: string): string {
    try {
      return path.resolve(root)
    } catch {
      return root
    }
  }

  async getWorkingTreeDiff(repoRoot: string, filePath: string, opts: { staged?: boolean } = {}): Promise<GitFileDiff> {
    const normalizedRoot = this.normalizeWorkspace(repoRoot)
    const staged = !!opts.staged

    // We ask git for a patch for a single file.
    // `--` ensures file paths aren't treated as rev specs.
    const args = staged
      ? ['diff', '--cached', '--no-color', '--unified=3', '--', filePath]
      : ['diff', '--no-color', '--unified=3', '--', filePath]

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: normalizedRoot,
        maxBuffer: 1024 * 1024 * 8,
      })

      const patchText = stdout ? stdout.toString() : ''
      const parsed = parseUnifiedDiff(patchText, { lenient: true })

      const rel = toPosixPath(path.relative(normalizedRoot, filePath))

      return {
        repoRoot: normalizedRoot,
        relativePath: rel,
        path: filePath,
        staged,
        hunks: parsed.hunks,
        isBinary: parsed.isBinary,
      }
    } catch (error: any) {
      const stderr: string = error?.stderr?.toString?.('utf8') ?? ''
      if (stderr.includes('Not a git repository') || stderr.includes('not a git repository')) {
        throw new Error('not-a-git-repo')
      }
      throw error
    }
  }

  async getCommitDiff(repoRoot: string, sha: string, filePath: string): Promise<GitFileDiff> {
    const normalizedRoot = this.normalizeWorkspace(repoRoot)

    // We want the diff of the commit. For a specific file, we use 'git show <sha> -- <path>'
    // which generates the patch format for that file in that commit.
    const args = ['show', '--no-color', '--unified=3', sha, '--', filePath]

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: normalizedRoot,
        maxBuffer: 1024 * 1024 * 8,
      })

      const patchText = stdout ? stdout.toString() : ''
      const parsed = parseUnifiedDiff(patchText, { lenient: true })

      const rel = toPosixPath(filePath)

      return {
        repoRoot: normalizedRoot,
        relativePath: rel,
        path: path.resolve(normalizedRoot, filePath),
        staged: false,
        hunks: parsed.hunks,
        isBinary: parsed.isBinary,
      }
    } catch (error: any) {
      const stderr: string = error?.stderr?.toString?.('utf8') ?? ''
      if (stderr.includes('Not a git repository')) {
        throw new Error('not-a-git-repo')
      }
      throw error
    }
  }
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/')
}
