import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import chokidar, { FSWatcher } from 'chokidar'
import { Service } from './base/Service.js'
import type { ExplorerService } from './ExplorerService.js'
import type { ExplorerFsEvent } from '../store/types.js'
import type { GitStatusSnapshot, GitStatusEntry } from '../../shared/git.js'
import * as gitStatusParser from './utils/gitStatusParser'

const execFileAsync = promisify(execFile)

interface WorkspaceGitState {
  snapshot: GitStatusSnapshot | null
  isRepo: boolean | null
  lastError: string | null
}

interface GitStatusState {
  workspaces: Record<string, WorkspaceGitState>
}

const REFRESH_DEBOUNCE_MS = 750

export class GitStatusService extends Service<GitStatusState> {
  private refreshTimers = new Map<string, NodeJS.Timeout>()
  private refreshPromises = new Map<string, Promise<void>>()
  private metadataWatchers = new Map<string, FSWatcher>()
  private snapshotSignatures = new Map<string, string>()
  private explorerListener?: (payload: ExplorerFsEvent) => void

  constructor() {
    super({ workspaces: {} })
  }

  protected onStateChange(): void {
    // Git status is transient - nothing to persist
  }

  attachExplorerService(explorer: ExplorerService): void {
    if (this.explorerListener) {
      explorer.off('explorer:fs:event', this.explorerListener)
    }
    this.explorerListener = (payload: ExplorerFsEvent) => {
      if (!payload?.workspaceRoot) return
      this.notifyFileSystemChange(payload.workspaceRoot)
    }
    explorer.on('explorer:fs:event', this.explorerListener)
  }

  private normalizeWorkspace(root: string): string {
    try {
      return path.resolve(root)
    } catch {
      return root
    }
  }

  private ensureWorkspaceEntry(root: string): WorkspaceGitState {
    const normalized = this.normalizeWorkspace(root)
    const existing = this.state.workspaces[normalized]
    if (existing) return existing
    const next: WorkspaceGitState = {
      snapshot: null,
      isRepo: null,
      lastError: null,
    }
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: next,
      },
    })
    return next
  }

  async prepareWorkspace(root: string): Promise<void> {
    const normalized = this.normalizeWorkspace(root)
    const entry = this.ensureWorkspaceEntry(normalized)
    if (entry.isRepo === false) return

    const isRepo = await this.detectGitRepository(normalized)
    this.updateWorkspaceMeta(normalized, { isRepo, lastError: null })

    if (!isRepo) {
      this.publishSnapshot(normalized, {
        workspaceRoot: normalized,
        generatedAt: Date.now(),
        isRepo: false,
        entries: [],
      })
      return
    }

    await this.startMetadataWatcher(normalized)
    await this.refreshWorkspace(normalized, 'initial')
  }

  async resetWorkspace(root: string): Promise<void> {
    const normalized = this.normalizeWorkspace(root)
    const timer = this.refreshTimers.get(normalized)
    if (timer) {
      clearTimeout(timer)
      this.refreshTimers.delete(normalized)
    }
    this.refreshPromises.delete(normalized)
    const watcher = this.metadataWatchers.get(normalized)
    if (watcher) {
      try {
        await watcher.close()
      } catch (error) {
        console.warn('[git-status] Failed to close metadata watcher', error)
      }
      this.metadataWatchers.delete(normalized)
    }
    if (this.state.workspaces[normalized]) {
      const next = { ...this.state.workspaces }
      delete next[normalized]
      this.setState({ workspaces: next })
    }
    this.snapshotSignatures.delete(normalized)
  }

  notifyFileSystemChange(workspaceRoot: string): void {
    const normalized = this.normalizeWorkspace(workspaceRoot)
    const entry = this.state.workspaces[normalized]
    if (entry && entry.isRepo === false) return
    this.scheduleRefresh(normalized, 'fs-event')
  }

  async getStatusSnapshot(workspaceRoot: string, opts: { refresh?: boolean } = {}): Promise<GitStatusSnapshot | null> {
    const normalized = this.normalizeWorkspace(workspaceRoot)
    await this.prepareWorkspace(normalized)
    const entry = this.state.workspaces[normalized]
    if (!entry?.isRepo) {
      return entry?.snapshot ?? {
        workspaceRoot: normalized,
        generatedAt: Date.now(),
        isRepo: false,
        entries: [],
      }
    }
    if (opts.refresh || !entry.snapshot) {
      await this.refreshWorkspace(normalized, 'rpc')
    }
    return this.state.workspaces[normalized]?.snapshot ?? null
  }

  private updateWorkspaceMeta(root: string, updates: Partial<WorkspaceGitState>): void {
    const normalized = this.normalizeWorkspace(root)
    const current = this.state.workspaces[normalized] ?? { snapshot: null, isRepo: null, lastError: null }
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: { ...current, ...updates },
      },
    })
  }

  private scheduleRefresh(root: string, reason: string): void {
    const normalized = this.normalizeWorkspace(root)
    if (this.refreshPromises.has(normalized)) return
    if (this.refreshTimers.has(normalized)) return
    const timer = setTimeout(() => {
      this.refreshTimers.delete(normalized)
      void this.refreshWorkspace(normalized, reason)
    }, reason === 'initial' ? 0 : REFRESH_DEBOUNCE_MS)
    this.refreshTimers.set(normalized, timer)
  }

  private async refreshWorkspace(root: string, reason: string): Promise<void> {
    const normalized = this.normalizeWorkspace(root)
    const entry = this.state.workspaces[normalized]
    if (entry?.isRepo === false) return

    const existingPromise = this.refreshPromises.get(normalized)
    if (existingPromise) {
      await existingPromise
      return
    }

    const promise = (async () => {
      try {
        const isRepo = await this.detectGitRepository(normalized)
        if (!isRepo) {
          this.updateWorkspaceMeta(normalized, { isRepo: false })
          this.publishSnapshot(normalized, {
            workspaceRoot: normalized,
            generatedAt: Date.now(),
            isRepo: false,
            entries: [],
          })
          return
        }
        const entries = await collectGitStatus(normalized)
        this.publishSnapshot(normalized, {
          workspaceRoot: normalized,
          generatedAt: Date.now(),
          isRepo: true,
          entries,
        })
      } catch (error: any) {
        const message = error?.message || String(error)
        if (message === 'not-a-git-repo') {
          this.updateWorkspaceMeta(normalized, { isRepo: false })
          this.publishSnapshot(normalized, {
            workspaceRoot: normalized,
            generatedAt: Date.now(),
            isRepo: false,
            entries: [],
          })
          return
        }
        console.warn(`[git-status] Failed to refresh for ${normalized} (${reason}):`, message)
        this.updateWorkspaceMeta(normalized, { lastError: message })
      }
    })()

    this.refreshPromises.set(normalized, promise)
    try {
      await promise
    } finally {
      this.refreshPromises.delete(normalized)
    }
  }

  private publishSnapshot(root: string, snapshot: GitStatusSnapshot): void {
    const normalized = this.normalizeWorkspace(root)
    const signature = buildSnapshotSignature(snapshot)
    if (this.snapshotSignatures.get(normalized) === signature) {
      return
    }
    this.snapshotSignatures.set(normalized, signature)
    this.updateWorkspaceMeta(normalized, { snapshot, isRepo: snapshot.isRepo, lastError: null })
    this.emit('git:status', snapshot)
  }

  private async detectGitRepository(root: string): Promise<boolean> {
    try {
      await fs.access(path.join(root, '.git'))
      return true
    } catch {
      // Fallback: use git rev-parse in case of worktree or bare repo
      try {
        await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root })
        return true
      } catch {
        return false
      }
    }
  }

  private async startMetadataWatcher(root: string): Promise<void> {
    if (this.metadataWatchers.has(root)) return
    const gitDir = path.join(root, '.git')
    try {
      await fs.access(gitDir)
    } catch {
      return
    }

    try {
      const watcher = chokidar.watch([path.join(gitDir, 'HEAD'), path.join(gitDir, 'index'), path.join(gitDir, 'refs')], {
        ignoreInitial: true,
        persistent: true,
        depth: 3,
      })
      watcher.on('all', () => {
        this.scheduleRefresh(root, 'git-metadata')
      })
      watcher.on('error', (error) => {
        console.warn('[git-status] Metadata watcher error:', error)
      })
      this.metadataWatchers.set(root, watcher)
    } catch (error) {
      console.warn('[git-status] Failed to start metadata watcher:', error)
    }
  }
}


function buildSnapshotSignature(snapshot: GitStatusSnapshot): string {
  const parts = snapshot.entries
    .map((entry) => `${entry.relativePath}:${entry.category}:${entry.staged ? '1' : '0'}:${entry.unstaged ? '1' : '0'}:${entry.renameFrom ?? ''}`)
    .sort()
  return `${snapshot.isRepo ? 'repo' : 'none'}|${parts.join('|')}`
}

export async function collectGitStatus(workspaceRoot: string): Promise<GitStatusEntry[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--ignored=matching'], {
      cwd: workspaceRoot,
      maxBuffer: 1024 * 1024 * 4,
    })
    // @ts-ignore - helper defined in TS module, runtime import handled by bundler
    return gitStatusParser.parseGitStatusPorcelain(stdout?.toString('utf8') ?? '', workspaceRoot)
  } catch (error: any) {
    const stderr: string = error?.stderr?.toString?.('utf8') ?? ''
    if (stderr.includes('Not a git repository') || stderr.includes('not a git repository')) {
      throw new Error('not-a-git-repo')
    }
    throw error
  }
}


