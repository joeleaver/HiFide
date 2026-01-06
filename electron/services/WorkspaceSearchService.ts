import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { Service } from './base/Service.js'
import { preferUnpackedRipgrepPath, findSystemRipgrep } from '../utils/ripgrep.js'
import { getVectorService, getSettingsService } from './index.js'
import type {
  WorkspaceSearchParams,
  WorkspaceSearchBatchPayload,
  WorkspaceSearchDonePayload,
  WorkspaceReplaceRequest,
  WorkspaceReplaceResponse,
  WorkspaceReplaceOperation,
  WorkspaceSearchMatch,
} from '../../shared/search.js'

interface WorkspaceSearchServiceState {
  activeJobs: Record<string, { workspaceRoot: string; query: string }>
}

interface WorkspaceSearchCallbacks {
  onBatch: (payload: WorkspaceSearchBatchPayload) => void
  onDone: (payload: WorkspaceSearchDonePayload) => void
}

interface NormalizedSearchParams {
  query: string
  isRegex: boolean
  matchCase: boolean
  matchWholeWord: boolean
  includeGlobs: string[]
  excludeGlobs: string[]
  useIgnoreFiles: boolean
  useGlobalIgnore: boolean
  maxResults: number
}

type WorkspaceSearchProcess = ChildProcessByStdio<null, Readable, Readable>

interface WorkspaceSearchJob {
  id: string
  workspaceRoot: string
  normalizedRoot: string
  params: NormalizedSearchParams
  process: WorkspaceSearchProcess
  startedAt: number
  callbacks: WorkspaceSearchCallbacks
  matchCount: number
  fileCount: number
  seenFiles: Set<string>
  pendingByFile: Map<string, WorkspaceSearchMatch[]>
  pendingMatches: number
  leftover: string
  stderr: string[]
  cancelled: boolean
  limitHit: boolean
}

const DEFAULT_MAX_RESULTS = 2000
const MAX_RESULTS_CAP = 10000
const MIN_RESULTS_CAP = 50
const BATCH_MATCH_THRESHOLD = 25

export class WorkspaceSearchService extends Service<WorkspaceSearchServiceState> {
  private ripgrepPath: string | null = null
  private jobs = new Map<string, WorkspaceSearchJob>()

  constructor() {
    super({ activeJobs: {} })
  }

  protected onStateChange(): void {
    // No persistence required for transient search jobs
  }

  async startWorkspaceSearch(
    workspaceRoot: string,
    params: WorkspaceSearchParams,
    callbacks: WorkspaceSearchCallbacks
  ): Promise<{ id: string; cancel: () => void }> {
    const searchId = randomUUID()
    const vectorSettings = getSettingsService().getState().vector;

    if (vectorSettings?.enabled) {
      // Background semantic search
      this.runSemanticSearch(workspaceRoot, searchId, params, callbacks).catch(err => {
        console.error('[search] Semantic search failed:', err);
      });
    }

    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const normalizedParams = this.normalizeParams(params)
    if (!normalizedParams.query) {
      throw new Error('query-required')
    }

    const rgPath = await this.getRipgrepPath()
    if (!rgPath) {
      throw new Error('ripgrep-unavailable')
    }

    const args = this.buildRipgrepArgs(normalizedParams)
    args.push('-e', normalizedParams.query)
    args.push('--', '.')

    const child = spawn(rgPath, args, { cwd: normalizedRoot, stdio: ['ignore', 'pipe', 'pipe'] }) as WorkspaceSearchProcess

    const job: WorkspaceSearchJob = {
      id: searchId,
      workspaceRoot,
      normalizedRoot,
      params: normalizedParams,
      process: child,
      startedAt: Date.now(),
      callbacks,
      matchCount: 0,
      fileCount: 0,
      seenFiles: new Set<string>(),
      pendingByFile: new Map(),
      pendingMatches: 0,
      leftover: '',
      stderr: [],
      cancelled: false,
      limitHit: false,
    }

    this.jobs.set(searchId, job)
    this.setState({
      activeJobs: {
        ...this.state.activeJobs,
        [searchId]: { workspaceRoot: normalizedRoot, query: normalizedParams.query },
      },
    })

    child.stdout.on('data', (buffer: Buffer) => {
      this.handleStdout(job, buffer.toString('utf-8'))
    })

    child.stderr.on('data', (buffer: Buffer) => {
      job.stderr.push(buffer.toString('utf-8'))
    })

    child.on('close', (code) => {
      this.finishJob(job, typeof code === 'number' ? code : 0)
    })

    child.on('error', (error) => {
      job.stderr.push(String(error))
    })

    const cancel = () => {
      if (job.cancelled) return
      job.cancelled = true
      try { child.kill('SIGTERM') } catch {}
    }

    return { id: searchId, cancel }
  }

  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    try { job.process.kill('SIGTERM') } catch {}
    job.cancelled = true
  }

  async applyWorkspaceReplacements(
    workspaceRoot: string,
    request: WorkspaceReplaceRequest
  ): Promise<WorkspaceReplaceResponse> {
    if (!request?.operations?.length) {
      return { updatedFiles: [], replacementsApplied: 0 }
    }

    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    let replacementsApplied = 0
    const updatedFiles: string[] = []

    for (const op of request.operations) {
      if (!op?.matches?.length) continue
      const absolutePath = this.resolveWorkspacePath(normalizedRoot, op.path)
      let content: string
      try {
        content = await fs.readFile(absolutePath, 'utf-8')
      } catch (error) {
        console.warn('[search] Failed to read file for replacement:', absolutePath, error)
        continue
      }

      const result = applyReplacementsToContent(content, op.matches)
      if (!result.changed) continue
      try {
        await fs.writeFile(absolutePath, result.content, 'utf-8')
        updatedFiles.push(this.toRelativePath(normalizedRoot, absolutePath))
        replacementsApplied += result.applied
      } catch (error) {
        console.warn('[search] Failed to write file after replacement:', absolutePath, error)
      }
    }

    return { updatedFiles, replacementsApplied }
  }

  private normalizeParams(params: WorkspaceSearchParams): NormalizedSearchParams {
    const maxResults = Math.min(
      Math.max(Number(params?.maxResults) || DEFAULT_MAX_RESULTS, MIN_RESULTS_CAP),
      MAX_RESULTS_CAP
    )
    return {
      query: String(params?.query ?? '').trim(),
      isRegex: !!params?.isRegex,
      matchCase: !!params?.matchCase,
      matchWholeWord: !!params?.matchWholeWord,
      includeGlobs: Array.isArray(params?.includeGlobs) ? params.includeGlobs.filter(Boolean) : [],
      excludeGlobs: Array.isArray(params?.excludeGlobs) ? params.excludeGlobs.filter(Boolean) : [],
      useIgnoreFiles: params?.useIgnoreFiles !== false,
      useGlobalIgnore: params?.useGlobalIgnore !== false,
      maxResults,
    }
  }

  private async getRipgrepPath(): Promise<string | null> {
    if (this.ripgrepPath) return this.ripgrepPath

    // Try vscode-ripgrep module first
    try {
      const mod: any = await import('vscode-ripgrep')
      const rgPath: string | undefined = mod?.rgPath || mod?.default?.rgPath
      if (rgPath) {
        const resolved = preferUnpackedRipgrepPath(rgPath)
        // Verify the binary actually exists before caching the path
        const { existsSync } = await import('node:fs')
        if (existsSync(resolved)) {
          this.ripgrepPath = resolved
          return resolved
        } else {
          console.warn('[search] ripgrep binary path exists in module but file not found:', resolved)
        }
      }
    } catch (error) {
      console.error('[search] Failed to load vscode-ripgrep module:', error)
    }

    // Fallback: try to find ripgrep installed on the system
    const systemRg = findSystemRipgrep()
    if (systemRg) {
      console.log('[search] Using system ripgrep:', systemRg)
      this.ripgrepPath = systemRg
      return systemRg
    }

    console.warn('[search] No ripgrep binary available. Text search will use Node.js fallback.')
    return null
  }

  private buildRipgrepArgs(params: NormalizedSearchParams): string[] {
    const args: string[] = ['--json', '--color', 'never', '--line-number', '--column', '--no-heading']
    if (!params.matchCase) args.push('--ignore-case')
    if (!params.isRegex) args.push('--fixed-strings')
    if (params.matchWholeWord) args.push('--word-regexp')
    if (!params.useIgnoreFiles) args.push('--no-ignore')
    if (!params.useGlobalIgnore) {
      args.push('--no-ignore-global')
      args.push('--no-ignore-parent')
    }

    for (const glob of params.includeGlobs) {
      args.push('--glob', glob)
    }
    for (const glob of params.excludeGlobs) {
      if (!glob) continue
      const cleaned = glob.startsWith('!') ? glob.slice(1) : glob
      args.push('--glob', `!${cleaned}`)
    }

    return args
  }

  private handleStdout(job: WorkspaceSearchJob, chunk: string): void {
    job.leftover += chunk
    let newlineIndex = job.leftover.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = job.leftover.slice(0, newlineIndex)
      job.leftover = job.leftover.slice(newlineIndex + 1)
      this.handleRipgrepLine(job, line)
      if (job.limitHit) break
      newlineIndex = job.leftover.indexOf('\n')
    }
  }

  private async runSemanticSearch(
    workspaceRoot: string,
    searchId: string,
    params: WorkspaceSearchParams,
    callbacks: WorkspaceSearchCallbacks
  ) {
    const vectorService = getVectorService();
    const results = await vectorService.search(workspaceRoot, params.query, 10);
    
    if (results.length === 0) return;

    const files: WorkspaceSearchBatchPayload['files'] = [];
    const filesMap = new Map<string, WorkspaceSearchMatch[]>();

    for (const match of results) {
      if (match.type !== 'code') continue;
      const relPath = match.filePath;
      if (!relPath) continue;
      
      const absPath = path.resolve(workspaceRoot, relPath);
      const startLine = (match.metadata as any)?.startLine || 1;
      const endLine = (match.metadata as any)?.endLine || startLine;

      const matches = filesMap.get(relPath) || [];
      matches.push({
        id: `semantic:${match.id}`,
        path: absPath,
        relativePath: relPath,
        line: startLine,
        column: 1,
        matchText: `[Semantic Match] ${match.text.split('\n')[0]}`,
        lineText: match.text.split('\n')[1] || match.text,
        range: {
          start: { line: startLine, column: 1 },
          end: { line: endLine, column: 1 }
        }
      });
      filesMap.set(relPath, matches);
    }

    for (const [relPath, matches] of filesMap.entries()) {
      files.push({
        path: path.resolve(workspaceRoot, relPath),
        relativePath: relPath,
        matches
      });
    }

    if (files.length > 0) {
      callbacks.onBatch({
        searchId,
        workspaceRoot,
        files,
        matchCount: results.length,
        fileCount: files.length,
        isSemantic: true
      } as any);
    }
  }

  private handleRipgrepLine(job: WorkspaceSearchJob, line: string): void {
    if (!line) return
    let payload: any
    try {
      payload = JSON.parse(line)
    } catch {
      return
    }
    if (payload?.type !== 'match') return
    const data = payload.data
    if (!data?.path?.text) return

    const absPath = this.resolveWorkspacePath(job.normalizedRoot, data.path.text)
    const relativePath = this.toRelativePath(job.normalizedRoot, absPath)
    if (!job.seenFiles.has(relativePath)) {
      job.seenFiles.add(relativePath)
      job.fileCount += 1
    }

    const match = this.buildMatch(job, data, relativePath, absPath)
    if (!match) return

    const existing = job.pendingByFile.get(relativePath) ?? []
    existing.push(match)
    job.pendingByFile.set(relativePath, existing)
    job.pendingMatches += 1
    job.matchCount += 1

    if (job.matchCount >= job.params.maxResults) {
      job.limitHit = true
      try { job.process.kill('SIGTERM') } catch {}
    }

    if (job.pendingMatches >= BATCH_MATCH_THRESHOLD) {
      this.flushJobResults(job)
    }
  }

  private buildMatch(
    job: WorkspaceSearchJob,
    data: any,
    relativePath: string,
    absPath: string
  ): WorkspaceSearchMatch | null {
    const lineNumber = Number(data.line_number) || 0
    const lineText: string = typeof data.lines?.text === 'string'
      ? data.lines.text.replace(/\r?\n$/, '')
      : ''
    const submatch = Array.isArray(data.submatches) && data.submatches.length > 0 ? data.submatches[0] : null
    const fallbackColumn = typeof data.column_number === 'number'
      ? Math.max(0, Number(data.column_number) - 1)
      : 0
    const start = typeof submatch?.start === 'number' ? submatch.start : fallbackColumn
    const end = typeof submatch?.end === 'number' ? submatch.end : start + (submatch?.match?.text?.length ?? 0)
    const matchText = typeof submatch?.match?.text === 'string' ? submatch.match.text : lineText.slice(start, end)

    const id = `${job.id}:${job.matchCount}`
    return {
      id,
      path: absPath,
      relativePath,
      line: lineNumber,
      column: start + 1,
      matchText,
      lineText,
      range: {
        start: { line: lineNumber, column: start + 1 },
        end: { line: lineNumber, column: end + 1 },
      },
    }
  }

  private flushJobResults(job: WorkspaceSearchJob): void {
    if (!job.pendingMatches) return
    const files: WorkspaceSearchBatchPayload['files'] = []
    for (const [relativePath, matches] of job.pendingByFile.entries()) {
      const absPath = this.resolveWorkspacePath(job.normalizedRoot, relativePath)
      files.push({ path: absPath, relativePath, matches: [...matches] })
    }
    job.pendingByFile.clear()
    job.pendingMatches = 0

    if (files.length === 0) return

    job.callbacks.onBatch({
      searchId: job.id,
      workspaceRoot: job.workspaceRoot,
      files,
      matchCount: job.matchCount,
      fileCount: job.fileCount,
    })
  }

  private finishJob(job: WorkspaceSearchJob, exitCode: number): void {
    this.flushJobResults(job)
    this.jobs.delete(job.id)
    const nextActive = { ...this.state.activeJobs }
    delete nextActive[job.id]
    this.setState({ activeJobs: nextActive })

    const durationMs = Date.now() - job.startedAt
    let error: string | null = null
    if (!job.cancelled && exitCode > 1) {
      error = job.stderr.join('\n') || 'search-failed'
    }

    job.callbacks.onDone({
      searchId: job.id,
      workspaceRoot: job.workspaceRoot,
      matchCount: job.matchCount,
      fileCount: job.fileCount,
      durationMs,
      cancelled: job.cancelled,
      limitHit: job.limitHit,
      error,
    })
  }

  private normalizeWorkspaceRoot(root: string): string {
    try {
      return path.resolve(root)
    } catch {
      return root
    }
  }

  private resolveWorkspacePath(workspaceRoot: string, targetPath?: string): string {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    if (!targetPath) return normalizedRoot
    const candidate = path.isAbsolute(targetPath) ? targetPath : path.join(normalizedRoot, targetPath)
    const resolved = path.resolve(candidate)
    const relative = path.relative(normalizedRoot, resolved)
    if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) {
      throw new Error(`[WorkspaceSearch] Path escapes workspace root: ${targetPath}`)
    }
    return resolved
  }

  private toRelativePath(workspaceRoot: string, absPath: string): string {
    const normalizedRoot = this.normalizeWorkspaceRoot(workspaceRoot)
    const relative = path.relative(normalizedRoot, absPath)
    return relative.split(path.sep).join('/')
  }
}

export function applyReplacementsToContent(
  content: string,
  matches: WorkspaceReplaceOperation['matches']
): { content: string; applied: number; changed: boolean } {
  if (!matches?.length) {
    return { content, applied: 0, changed: false }
  }
  const sorted = [...matches].sort((a, b) => {
    if (a.start.line === b.start.line) {
      return b.start.column - a.start.column
    }
    return b.start.line - a.start.line
  })

  const lineOffsets = buildLineOffsets(content)
  let nextContent = content
  let applied = 0
  for (const match of sorted) {
    const startOffset = getOffsetFromPosition(lineOffsets, match.start)
    const endOffset = getOffsetFromPosition(lineOffsets, match.end)
    if (startOffset == null || endOffset == null || endOffset < startOffset) {
      continue
    }
    nextContent = `${nextContent.slice(0, startOffset)}${match.replacement ?? ''}${nextContent.slice(endOffset)}`
    applied += 1
  }

  return { content: nextContent, applied, changed: applied > 0 }
}

function buildLineOffsets(content: string): number[] {
  const offsets = [0]
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') {
      offsets.push(i + 1)
    }
  }
  return offsets
}

function getOffsetFromPosition(offsets: number[], pos: { line: number; column: number }): number | null {
  const lineIndex = Math.max(0, (pos.line || 1) - 1)
  if (lineIndex >= offsets.length) {
    return offsets[offsets.length - 1] + Math.max(0, (pos.column || 1) - 1)
  }
  return offsets[lineIndex] + Math.max(0, (pos.column || 1) - 1)
}
