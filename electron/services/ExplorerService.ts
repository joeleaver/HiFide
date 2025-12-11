/**
 * Explorer Service
 *
 * Manages file system interactions for the Explorer/Editor surface.
 * Handles directory listings, file IO, and workspace-scoped filesystem watchers.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { Dirent, Stats } from 'node:fs'
import chokidar, { FSWatcher } from 'chokidar'
import { Service } from './base/Service.js'
import { detectLanguageFromPath } from '../../shared/language.js'
import type { ExplorerEntry, ExplorerFsEvent, OpenedFile } from '../store/types.js'

type Encoding = BufferEncoding

interface ExplorerWorkspaceState {
  openFolders: string[]
  childrenByDir: Record<string, ExplorerEntry[]>
  openedFile: OpenedFile | null
}

function validateFsName(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new Error('Name is required')
  if (/[\\/:*?"<>|]/.test(trimmed)) throw new Error('Name contains invalid characters')
  if (trimmed === '.' || trimmed === '..') throw new Error('Name is invalid')
  return trimmed
}

function pathsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return path.resolve(a) === path.resolve(b)
}

interface ExplorerState {
  workspaces: Record<string, ExplorerWorkspaceState>
}

const DEFAULT_ENCODING: Encoding = 'utf-8'

const WATCHER_IGNORE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.next',
  '.cache',
  '.hifide-private',
  'dist',
  'build',
  'coverage',
  'out',
])

const WATCHER_EVENT_MAP: Record<string, ExplorerFsEvent['kind']> = {
  add: 'file-added',
  change: 'file-updated',
  unlink: 'file-removed',
  addDir: 'dir-added',
  unlinkDir: 'dir-removed',
}

export class ExplorerService extends Service<ExplorerState> {
  private watchers = new Map<string, FSWatcher>()
  private watcherPromises = new Map<string, Promise<void>>()

  constructor() {
    super({ workspaces: {} })
  }

  protected onStateChange(): void {
    // Explorer state is transient; nothing to persist
  }

  // ---------------------------------------------------------------------------
  // Workspace snapshot helpers
  // ---------------------------------------------------------------------------
  private normalizeWorkspaceRoot(workspaceRoot: string): string {
    return path.resolve(workspaceRoot)
  }

  private ensureWorkspaceState(workspaceRoot: string): ExplorerWorkspaceState {
    const normalized = this.normalizeWorkspaceRoot(workspaceRoot)
    const existing = this.state.workspaces[normalized]
    if (existing) return existing

    const initial: ExplorerWorkspaceState = {
      openFolders: [normalized],
      childrenByDir: {},
      openedFile: null,
    }

    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: initial,
      },
    })

    return initial
  }

  private updateWorkspaceState(workspaceRoot: string, next: ExplorerWorkspaceState): ExplorerWorkspaceState {
    const normalized = this.normalizeWorkspaceRoot(workspaceRoot)
    const nextSnapshot: ExplorerWorkspaceState = {
      openFolders: [...next.openFolders].map((folder) => this.resolveWorkspacePath(normalized, folder)),
      childrenByDir: Object.fromEntries(
        Object.entries(next.childrenByDir).map(([dir, entries]) => [
          this.resolveWorkspacePath(normalized, dir),
          this.cloneEntries(entries),
        ])
      ),
      openedFile: next.openedFile ? { ...next.openedFile } : null,
    }

    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: nextSnapshot,
      },
    })

    return nextSnapshot
  }

  private cloneEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
    return entries.map((entry) => ({ ...entry }))
  }

  private cloneChildren(map: Record<string, ExplorerEntry[]>): Record<string, ExplorerEntry[]> {
    const clone: Record<string, ExplorerEntry[]> = {}
    for (const [dir, entries] of Object.entries(map)) {
      clone[dir] = this.cloneEntries(entries)
    }
    return clone
  }

  private resolveWorkspacePath(workspaceRoot: string, targetPath?: string): string {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    if (!targetPath) return normalizedRoot

    const candidate = path.isAbsolute(targetPath) ? targetPath : path.join(normalizedRoot, targetPath)
    const resolved = path.resolve(candidate)
    const relative = path.relative(normalizedRoot, resolved)
    if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) {
      throw new Error(`[ExplorerService] Path escapes workspace root: ${targetPath}`)
    }
    return resolved
  }

  private toRelativePath(workspaceRoot: string, absolutePath: string): string {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const relative = path.relative(normalizedRoot, absolutePath)
    if (!relative) return ''
    return relative.split(path.sep).join('/')
  }

  private shouldIgnoreForWatcher(workspaceRoot: string, filePath: string): boolean {
    try {
      const rel = this.toRelativePath(workspaceRoot, filePath)
      if (!rel) return false
      return rel.split(/[\\/]+/).some((segment) => WATCHER_IGNORE_SEGMENTS.has(segment))
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Public snapshot accessors
  // ---------------------------------------------------------------------------
  getOpenFolders(workspaceRoot: string): string[] {
    const state = this.ensureWorkspaceState(workspaceRoot)
    return [...state.openFolders]
  }

  getChildrenByDir(workspaceRoot: string): Record<string, ExplorerEntry[]> {
    const state = this.ensureWorkspaceState(workspaceRoot)
    return this.cloneChildren(state.childrenByDir)
  }

  getOpenedFile(workspaceRoot: string): OpenedFile | null {
    const state = this.ensureWorkspaceState(workspaceRoot)
    return state.openedFile ? { ...state.openedFile } : null
  }

  getWorkspaceSnapshot(workspaceRoot: string): {
    openFolders: string[]
    childrenByDir: Record<string, ExplorerEntry[]>
    openedFile: OpenedFile | null
  } {
    const state = this.ensureWorkspaceState(workspaceRoot)
    return {
      openFolders: [...state.openFolders],
      childrenByDir: this.cloneChildren(state.childrenByDir),
      openedFile: state.openedFile ? { ...state.openedFile } : null,
    }
  }

  // ---------------------------------------------------------------------------
  // Directory operations
  // ---------------------------------------------------------------------------
  async listDirectory(
    workspaceRoot: string,
    targetDir?: string,
    opts?: { includeStats?: boolean }
  ): Promise<ExplorerEntry[]> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const directory = this.resolveWorkspacePath(normalizedRoot, targetDir)
    const includeStats = !!opts?.includeStats

    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      throw new Error(`[ExplorerService] Failed to list directory ${directory}: ${String(error)}`)
    }

    const entries: ExplorerEntry[] = []
    for (const dirent of dirents) {
      const absPath = path.join(directory, dirent.name)
      const relPath = this.toRelativePath(normalizedRoot, absPath)
      const entry: ExplorerEntry = {
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        path: absPath,
        relativePath: relPath,
      }

      if (includeStats) {
        try {
          const stats = await fs.stat(absPath)
          entry.size = stats.size
          entry.mtimeMs = stats.mtimeMs ?? stats.mtime.getTime()
        } catch {}
      }

      entries.push(entry)
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return entries
  }

  async loadExplorerDir(workspaceRoot: string, dirPath: string): Promise<ExplorerEntry[]> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const entries = await this.listDirectory(normalizedRoot, dirPath)
    const state = this.ensureWorkspaceState(normalizedRoot)
    const next: ExplorerWorkspaceState = {
      ...state,
      childrenByDir: {
        ...state.childrenByDir,
        [this.resolveWorkspacePath(normalizedRoot, dirPath)]: this.cloneEntries(entries),
      },
    }
    this.updateWorkspaceState(normalizedRoot, next)
    return entries
  }

  async toggleExplorerFolder(
    workspaceRoot: string,
    dirPath: string
  ): Promise<{ openFolders: string[]; childrenByDir: Record<string, ExplorerEntry[]> }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const state = this.ensureWorkspaceState(normalizedRoot)
    const targetDir = this.resolveWorkspacePath(normalizedRoot, dirPath)
    const isOpen = state.openFolders.includes(targetDir)

    let openFolders: string[]
    let childrenByDir = state.childrenByDir

    if (isOpen) {
      openFolders = state.openFolders.filter((folder) => folder !== targetDir)
    } else {
      openFolders = [...state.openFolders, targetDir]
      const entries = await this.listDirectory(normalizedRoot, targetDir)
      childrenByDir = {
        ...childrenByDir,
        [targetDir]: this.cloneEntries(entries),
      }
    }

    const snapshot = this.updateWorkspaceState(normalizedRoot, {
      ...state,
      openFolders,
      childrenByDir,
    })

    return {
      openFolders: [...snapshot.openFolders],
      childrenByDir: this.cloneChildren(snapshot.childrenByDir),
    }
  }

  // ---------------------------------------------------------------------------
  // File IO
  // ---------------------------------------------------------------------------
  async readFile(workspaceRoot: string, filePath: string, encoding: Encoding = DEFAULT_ENCODING): Promise<OpenedFile> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const absolutePath = this.resolveWorkspacePath(normalizedRoot, filePath)

    const [content, stats] = await Promise.all([
      fs.readFile(absolutePath, { encoding }),
      fs.stat(absolutePath),
    ])

    return {
      path: absolutePath,
      relativePath: this.toRelativePath(normalizedRoot, absolutePath),
      content,
        language: detectLanguageFromPath(absolutePath),
      encoding,
      size: stats.size,
      mtimeMs: stats.mtimeMs ?? stats.mtime.getTime(),
    }
  }

  async writeFile(
    workspaceRoot: string,
    filePath: string,
    content: string,
    encoding: Encoding = DEFAULT_ENCODING
  ): Promise<{ path: string; relativePath: string; size: number; mtimeMs: number }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const absolutePath = this.resolveWorkspacePath(normalizedRoot, filePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content, { encoding })
    const stats = await fs.stat(absolutePath)

    return {
      path: absolutePath,
      relativePath: this.toRelativePath(normalizedRoot, absolutePath),
      size: stats.size,
      mtimeMs: stats.mtimeMs ?? stats.mtime.getTime(),
    }
  }

  async createEntry(
    workspaceRoot: string,
    parentDir: string,
    name: string,
    opts: { type: 'file' | 'folder'; content?: string } = { type: 'file' }
  ): Promise<{ path: string; relativePath: string }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const safeName = validateFsName(name)
    const directory = this.resolveWorkspacePath(normalizedRoot, parentDir)
    const targetName = await this.ensureAvailableName(directory, safeName)
    const targetPath = path.join(directory, targetName)

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    if (opts.type === 'folder') {
      await fs.mkdir(targetPath, { recursive: true })
    } else {
      await fs.writeFile(targetPath, opts.content ?? '', { encoding: DEFAULT_ENCODING })
    }

    return {
      path: targetPath,
      relativePath: this.toRelativePath(normalizedRoot, targetPath),
    }
  }

  async renameEntry(
    workspaceRoot: string,
    targetPath: string,
    newName: string
  ): Promise<{ path: string; relativePath: string }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const absolutePath = this.resolveWorkspacePath(normalizedRoot, targetPath)
    const safeName = validateFsName(newName)
    const parentDir = path.dirname(absolutePath)
    const destinationName = await this.ensureAvailableName(parentDir, safeName, absolutePath)
    const destinationPath = path.join(parentDir, destinationName)

    if (pathsEqual(destinationPath, absolutePath)) {
      return {
        path: absolutePath,
        relativePath: this.toRelativePath(normalizedRoot, absolutePath),
      }
    }

    await fs.mkdir(parentDir, { recursive: true })
    await fs.rename(absolutePath, destinationPath)
    return {
      path: destinationPath,
      relativePath: this.toRelativePath(normalizedRoot, destinationPath),
    }
  }

  async deleteEntry(workspaceRoot: string, targetPath: string): Promise<{ path: string }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const absolutePath = this.resolveWorkspacePath(normalizedRoot, targetPath)
    await fs.rm(absolutePath, { recursive: true, force: true })
    return { path: absolutePath }
  }

  async duplicateEntry(
    workspaceRoot: string,
    targetPath: string
  ): Promise<{ path: string; relativePath: string }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const absolutePath = this.resolveWorkspacePath(normalizedRoot, targetPath)
    const stats = await fs.stat(absolutePath)
    const parentDir = path.dirname(absolutePath)
    const baseName = path.basename(absolutePath)
    const proposed = stats.isDirectory() ? `${baseName} copy` : `${baseName} copy`
    const destinationName = await this.ensureAvailableName(parentDir, proposed)
    const destinationPath = path.join(parentDir, destinationName)
    await fs.mkdir(parentDir, { recursive: true })
    await fs.cp(absolutePath, destinationPath, { recursive: true })
    return {
      path: destinationPath,
      relativePath: this.toRelativePath(normalizedRoot, destinationPath),
    }
  }

  async pasteEntries(
    workspaceRoot: string,
    sources: string[],
    destinationDir: string,
    opts: { mode?: 'copy' | 'cut' } = {}
  ): Promise<{ paths: string[] }> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    if (!sources.length) return { paths: [] }
    const destDir = this.resolveWorkspacePath(normalizedRoot, destinationDir)
    await fs.mkdir(destDir, { recursive: true })

    const createdPaths: string[] = []
    const mode = opts.mode === 'cut' ? 'cut' : 'copy'

    for (const source of sources) {
      const absoluteSource = this.resolveWorkspacePath(normalizedRoot, source)
      await fs.access(absoluteSource)
      const targetName = await this.ensureAvailableName(destDir, path.basename(absoluteSource), mode === 'cut' ? absoluteSource : undefined)
      const destinationPath = path.join(destDir, targetName)
      await fs.mkdir(path.dirname(destinationPath), { recursive: true })
      await fs.cp(absoluteSource, destinationPath, { recursive: true })
      if (mode === 'cut') {
        await fs.rm(absoluteSource, { recursive: true, force: true })
      }
      createdPaths.push(destinationPath)
    }

    return { paths: createdPaths.map((absPath) => this.toRelativePath(normalizedRoot, absPath)) }
  }

  async openFile(workspaceRoot: string, filePath: string): Promise<OpenedFile> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const file = await this.readFile(normalizedRoot, filePath)
    const state = this.ensureWorkspaceState(normalizedRoot)
    this.updateWorkspaceState(normalizedRoot, { ...state, openedFile: file })
    return file
  }

  closeFile(workspaceRoot: string): void {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const state = this.ensureWorkspaceState(normalizedRoot)
    if (!state.openedFile) return
    this.updateWorkspaceState(normalizedRoot, { ...state, openedFile: null })
  }

  // ---------------------------------------------------------------------------
  // Watchers
  // ---------------------------------------------------------------------------
  async startWorkspaceWatcher(workspaceRoot: string): Promise<void> {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    if (this.watchers.has(normalizedRoot)) return
    const pending = this.watcherPromises.get(normalizedRoot)
    if (pending) return pending

    const startPromise = (async () => {
      try {
        await fs.access(normalizedRoot)
      } catch (error) {
        console.error(`[ExplorerService] Cannot start watcher, workspace missing: ${normalizedRoot}`, error)
        return
      }

      const watcher = chokidar.watch(normalizedRoot, {
        ignoreInitial: true,
        persistent: true,
        followSymlinks: false,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 50,
        },
        ignored: (watchedPath: string) => this.shouldIgnoreForWatcher(normalizedRoot, watchedPath),
      })

      watcher.on('all', (event: string, targetPath: string, stats?: Stats) => {
        this.handleWatcherEvent(normalizedRoot, event, targetPath, stats).catch((err) => {
          console.error('[ExplorerService] Failed to process watcher event:', err)
        })
      })

      watcher.on('error', (error: unknown) => {
        console.error(`[ExplorerService] Watcher error for ${normalizedRoot}:`, error)
      })

      this.watchers.set(normalizedRoot, watcher)
    })().finally(() => {
      this.watcherPromises.delete(normalizedRoot)
    })

    this.watcherPromises.set(normalizedRoot, startPromise)
    return startPromise
  }

  async stopWorkspaceWatcher(workspaceRoot?: string): Promise<void> {
    if (!workspaceRoot) {
      await Promise.all(Array.from(this.watchers.keys()).map((root) => this.stopWorkspaceWatcher(root)))
      return
    }

    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const watcher = this.watchers.get(normalizedRoot)
    if (watcher) {
      try { await watcher.close() } catch (error) {
        console.error(`[ExplorerService] Failed to stop watcher for ${normalizedRoot}:`, error)
      }
      this.watchers.delete(normalizedRoot)
    }
    this.watcherPromises.delete(normalizedRoot)

    if (this.state.workspaces[normalizedRoot]) {
      const nextWorkspaces = { ...this.state.workspaces }
      delete nextWorkspaces[normalizedRoot]
      this.setState({ workspaces: nextWorkspaces })
    }
  }

  private async handleWatcherEvent(
    workspaceRoot: string,
    event: string,
    targetPath: string,
    stats?: Stats
  ): Promise<void> {
    const kind = WATCHER_EVENT_MAP[event]
    if (!kind) return

    const absolutePath = path.resolve(targetPath)
    if (this.shouldIgnoreForWatcher(workspaceRoot, absolutePath)) return

    let metadata = stats
    if (!metadata && (kind === 'file-added' || kind === 'file-updated')) {
      try {
        metadata = await fs.stat(absolutePath)
      } catch {}
    }

    const payload: ExplorerFsEvent = {
      workspaceRoot: this.normalizeWorkspaceRoot(workspaceRoot),
      path: absolutePath,
      relativePath: this.toRelativePath(workspaceRoot, absolutePath),
      kind,
      isDirectory: kind === 'dir-added' || kind === 'dir-removed' || metadata?.isDirectory() === true,
      size: metadata?.size,
      mtimeMs: metadata ? metadata.mtimeMs ?? metadata.mtime.getTime() : undefined,
      updatedAt: Date.now(),
    }

    this.emit('explorer:fs:event', payload)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensureAvailableName(dirPath: string, desiredName: string, existingPath?: string): Promise<string> {
    const safeName = validateFsName(desiredName)
    const extIndex = safeName.lastIndexOf('.')
    const stem = extIndex > 0 ? safeName.slice(0, extIndex) : safeName
    const ext = extIndex > 0 ? safeName.slice(extIndex) : ''

    let attempt = safeName
    let counter = 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidate = path.join(dirPath, attempt)
      if (existingPath && pathsEqual(candidate, existingPath)) {
        return attempt
      }
      try {
        await fs.access(candidate)
      } catch {
        return attempt
      }
      counter += 1
      attempt = `${stem} copy${counter > 1 ? ` ${counter}` : ''}${ext}`
    }
  }
 
 }