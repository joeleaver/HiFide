import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { EmbeddingEngine, getLocalEngine, cosine } from './engine'

export type Chunk = {
  path: string
  startLine: number
  endLine: number
  text: string
  vector: number[]
}

export type IndexMeta = {
  modelId: string
  dim: number
  createdAt: number
}

type IndexData = { meta: IndexMeta; chunks: Chunk[] }

export class Indexer {
  private engine: EmbeddingEngine | null = null
  private data: IndexData | null = null
  private root: string
  private indexPath: string

  // progress & cancel
  private inProgress = false
  private cancelled = false
  private progress: {
    phase: 'idle'|'scanning'|'embedding'|'saving'|'done'|'cancelled'
    processedFiles: number
    totalFiles: number
    processedChunks: number
    totalChunks: number
    startedAt: number | null
  } = { phase: 'idle', processedFiles: 0, totalFiles: 0, processedChunks: 0, totalChunks: 0, startedAt: null }

  constructor(root: string) {
    this.root = root
    const base = app.getPath('userData')
    this.indexPath = path.join(base, 'index', 'index.json')
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true })
  }

  status() {
    const exists = fs.existsSync(this.indexPath)
    const elapsedMs = this.progress.startedAt ? Date.now() - this.progress.startedAt : 0
    return {
      ready: !!this.data,
      chunks: this.data?.chunks.length ?? 0,
      modelId: this.data?.meta.modelId,
      dim: this.data?.meta.dim,
      indexPath: this.indexPath,
      exists,
      inProgress: this.inProgress,
      phase: this.progress.phase,
      processedFiles: this.progress.processedFiles,
      totalFiles: this.progress.totalFiles,
      processedChunks: this.progress.processedChunks,
      totalChunks: this.progress.totalChunks,
      elapsedMs,
    }
  }

  clear() {
    this.data = null
    try { fs.unlinkSync(this.indexPath) } catch {}
  }

  private defaultExcludes = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '.turbo', '.yarn', '.pnpm-store', 'out', '.idea', '.vscode'
  ])

  private gitignoreDirs: string[] = []

  private loadGitignore() {
    this.gitignoreDirs = []
    try {
      const gi = fs.readFileSync(path.join(this.root, '.gitignore'), 'utf-8')
      for (const raw of gi.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        // Very simple: only support directory entries like foo/ and bare names
        const dir = line.endsWith('/') ? line.slice(0, -1) : line
        if (dir && !dir.includes('*') && !dir.includes('?') && !dir.startsWith('!')) {
          this.gitignoreDirs.push(dir)
        }
      }
    } catch { /* no gitignore */ }
  }

  private shouldSkip(filePath: string): boolean {
    const rel = path.relative(this.root, filePath)
    // skip if inside excluded dirs
    const parts = rel.split(path.sep)
    if (parts.some((p) => this.defaultExcludes.has(p))) return true
    if (parts.some((p) => this.gitignoreDirs.includes(p))) return true
    const ext = path.extname(filePath).toLowerCase()
    const binExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.ico', '.dll', '.exe'])
    if (binExts.has(ext)) return true
    return false
  }

  private scanFiles(dir: string, out: string[] = []): string[] {
    // Avoid following excluded directories
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        const rel = path.relative(this.root, p)
        const seg = rel.split(path.sep).pop() || ''
        if (this.defaultExcludes.has(seg) || this.gitignoreDirs.includes(seg)) continue
        this.scanFiles(p, out)
      } else {
        out.push(p)
      }
    }
    return out
  }

  private chunkText(text: string, maxLines = 60): { startLine: number; endLine: number; text: string }[] {
    const lines = text.split(/\r?\n/)
    const chunks: { startLine: number; endLine: number; text: string }[] = []
    for (let i = 0; i < lines.length; i += maxLines) {
      const sl = i + 1
      const el = Math.min(lines.length, i + maxLines)
      chunks.push({ startLine: sl, endLine: el, text: lines.slice(i, el).join('\n') })
    }
    return chunks
  }

  cancel() { if (this.inProgress) this.cancelled = true }

  async rebuild(onProgress?: (p: ReturnType<Indexer['status']>) => void): Promise<void> {
    if (!this.engine) this.engine = await getLocalEngine()
    this.loadGitignore()
    this.inProgress = true
    this.cancelled = false
    this.progress = { phase: 'scanning', processedFiles: 0, totalFiles: 0, processedChunks: 0, totalChunks: 0, startedAt: Date.now() }
    onProgress?.(this.status())

    const filesAll = this.scanFiles(this.root)
    const files = filesAll.filter((f) => !this.shouldSkip(f))
    this.progress.totalFiles = files.length

    const chunks: Omit<Chunk, 'vector'>[] = []
    for (const f of files) {
      if (this.cancelled) { this.progress.phase = 'cancelled'; this.inProgress = false; onProgress?.(this.status()); return }
      let text = ''
      try { text = fs.readFileSync(f, 'utf-8') } catch { this.progress.processedFiles++; continue }
      const parts = this.chunkText(text)
      for (const part of parts) chunks.push({ path: path.relative(this.root, f), startLine: part.startLine, endLine: part.endLine, text: part.text })
      this.progress.processedFiles++
      this.progress.totalChunks = chunks.length
      onProgress?.(this.status())
    }

    this.progress.phase = 'embedding'
    onProgress?.(this.status())

    const vectors = await this.engine.embed(chunks.map((c) => c.text))
    this.progress.processedChunks = vectors.length

    this.progress.phase = 'saving'
    onProgress?.(this.status())

    const full: IndexData = {
      meta: { modelId: this.engine.id, dim: this.engine.dim, createdAt: Date.now() },
      chunks: chunks.map((c, i) => ({ ...c, vector: vectors[i] })),
    }
    this.data = full
    fs.writeFileSync(this.indexPath, JSON.stringify(full, null, 2), 'utf-8')

    this.inProgress = false
    this.progress.phase = 'done'
    onProgress?.(this.status())
  }

  ensureLoadedFromDisk() {
    if (this.data) return
    try {
      const raw = fs.readFileSync(this.indexPath, 'utf-8')
      this.data = JSON.parse(raw)
    } catch {
      // no-op
    }
  }

  async search(query: string, k = 8): Promise<{ chunks: Chunk[] }> {
    this.ensureLoadedFromDisk()
    if (!this.data) return { chunks: [] }
    if (!this.engine) this.engine = await getLocalEngine()

    const [qv] = await this.engine.embed([query])
    const scored = this.data.chunks
      .map((c) => ({ c, score: cosine(qv, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.c)
    return { chunks: scored }
  }
  // Simple watcher (best-effort). On Windows/macOS recursive fs.watch works; on Linux may be limited.
  private watcher: fs.FSWatcher | null = null
  private debounceTimer: any = null

  startWatch(onEvent?: (p: ReturnType<Indexer['status']>) => void) {
    if (this.watcher) return
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, async (_event, filename) => {
        if (!filename) return
        if (this.inProgress) return // avoid interfering during full rebuild
        clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(async () => {
          try {
            const abs = path.join(this.root, filename)
            if (this.shouldSkip(abs)) return
            // Update single file
            if (!this.engine) this.engine = await getLocalEngine()
            const rel = path.relative(this.root, abs)
            let text = ''
            try { text = fs.readFileSync(abs, 'utf-8') } catch { /* file may be removed */ }
            const parts = text ? this.chunkText(text) : []
            const vectors = parts.length ? await this.engine.embed(parts.map(p => p.text)) : []
            const newChunks: Chunk[] = parts.map((p, i) => ({ path: rel, startLine: p.startLine, endLine: p.endLine, text: p.text, vector: vectors[i] }))
            this.ensureLoadedFromDisk()
            if (!this.data) return
            // remove old chunks for file
            this.data.chunks = this.data.chunks.filter(c => c.path !== rel)
            // add new ones
            this.data.chunks.push(...newChunks)
            fs.writeFileSync(this.indexPath, JSON.stringify(this.data, null, 2), 'utf-8')
            onEvent?.(this.status())
          } catch { /* ignore */ }
        }, 500)
      })
    } catch { /* fs.watch may not support recursive */ }
  }

  stopWatch() {
    try { this.watcher?.close() } catch {}
    this.watcher = null
  }

}
