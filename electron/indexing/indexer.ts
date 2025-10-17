import fs from 'node:fs'
import path from 'node:path'
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
  private indexDir: string
  private readonly CHUNKS_PER_FILE = 1000 // Split into files of 1000 chunks each

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
    // Store index in workspace .hifide-private/indexes/
    const privateDir = path.join(root, '.hifide-private')
    this.indexDir = path.join(privateDir, 'indexes')
    this.indexPath = path.join(this.indexDir, 'meta.json')
    fs.mkdirSync(this.indexDir, { recursive: true })
  }

  status() {
    const exists = fs.existsSync(this.indexPath)
    const elapsedMs = this.progress.startedAt ? Date.now() - this.progress.startedAt : 0

    // Get chunk count from metadata file if available
    let chunkCount = this.data?.chunks.length ?? 0
    if (chunkCount === 0 && exists) {
      try {
        const metaRaw = fs.readFileSync(this.indexPath, 'utf-8')
        const { totalChunks } = JSON.parse(metaRaw)
        chunkCount = totalChunks || 0
      } catch {}
    }

    return {
      ready: !!this.data,
      chunks: chunkCount,
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
    // Remove all chunk files
    try {
      const chunkFiles = fs.readdirSync(this.indexDir).filter(f => f.startsWith('chunks-'))
      for (const f of chunkFiles) {
        try { fs.unlinkSync(path.join(this.indexDir, f)) } catch {}
      }
    } catch {}
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

    // Embed in batches to avoid memory issues with large codebases
    const EMBED_BATCH_SIZE = 100
    const vectors: number[][] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      if (this.cancelled) { this.progress.phase = 'cancelled'; this.inProgress = false; onProgress?.(this.status()); return }
      const batchEnd = Math.min(i + EMBED_BATCH_SIZE, chunks.length)
      const batchTexts = chunks.slice(i, batchEnd).map((c) => c.text)
      const batchVectors = await this.engine.embed(batchTexts)
      vectors.push(...batchVectors)
      this.progress.processedChunks = vectors.length
      onProgress?.(this.status())
    }

    this.progress.phase = 'saving'
    onProgress?.(this.status())

    const meta: IndexMeta = { modelId: this.engine.id, dim: this.engine.dim, createdAt: Date.now() }

    // Clear old chunk files
    try {
      const oldFiles = fs.readdirSync(this.indexDir).filter(f => f.startsWith('chunks-'))
      for (const f of oldFiles) {
        try { fs.unlinkSync(path.join(this.indexDir, f)) } catch {}
      }
    } catch {}

    // Write metadata
    fs.writeFileSync(this.indexPath, JSON.stringify({ meta, totalChunks: chunks.length }), 'utf-8')

    // Write chunks in separate files (1000 chunks per file)
    // Process in batches to avoid creating huge arrays in memory
    for (let i = 0; i < chunks.length; i += this.CHUNKS_PER_FILE) {
      const batchSize = Math.min(this.CHUNKS_PER_FILE, chunks.length - i)
      const batch: Chunk[] = []

      for (let j = 0; j < batchSize; j++) {
        const idx = i + j
        batch.push({ ...chunks[idx], vector: vectors[idx] })
      }

      const chunkFile = path.join(this.indexDir, `chunks-${Math.floor(i / this.CHUNKS_PER_FILE)}.json`)
      try {
        fs.writeFileSync(chunkFile, JSON.stringify(batch), 'utf-8')
      } catch (e: any) {
        console.error(`[indexer] Failed to write chunk file ${chunkFile}:`, e.message)
        throw new Error(`Failed to save index chunk ${Math.floor(i / this.CHUNKS_PER_FILE)}: ${e.message}`)
      }
    }

    // Don't store full chunks in memory - load on demand from disk
    // Just store metadata so status() works
    this.data = { meta, chunks: [] }


    this.inProgress = false
    this.progress.phase = 'done'
    onProgress?.(this.status())
  }

  ensureLoadedFromDisk() {
    if (this.data) return
    try {
      // Read metadata
      const metaRaw = fs.readFileSync(this.indexPath, 'utf-8')
      const { meta } = JSON.parse(metaRaw)

      // Read all chunk files
      const allChunks: Chunk[] = []
      const chunkFiles = fs.readdirSync(this.indexDir)
        .filter(f => f.startsWith('chunks-'))
        .sort((a, b) => {
          const aNum = parseInt(a.replace('chunks-', '').replace('.json', ''))
          const bNum = parseInt(b.replace('chunks-', '').replace('.json', ''))
          return aNum - bNum
        })

      for (const file of chunkFiles) {
        const chunkRaw = fs.readFileSync(path.join(this.indexDir, file), 'utf-8')
        const batch: Chunk[] = JSON.parse(chunkRaw)
        allChunks.push(...batch)
      }

      this.data = { meta, chunks: allChunks }
    } catch (e) {
      console.error('[indexer] Failed to load index from disk:', e)
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

    // Log top 10 results with scores
    scored.slice(0, 10).forEach(() => {
    })

    const results = scored.slice(0, k).map((x) => x.c)
    return { chunks: results }
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

            // Save updated index using chunked storage
            try {
              // Clear old chunk files
              const oldFiles = fs.readdirSync(this.indexDir).filter(f => f.startsWith('chunks-'))
              for (const f of oldFiles) {
                try { fs.unlinkSync(path.join(this.indexDir, f)) } catch {}
              }

              // Write metadata
              fs.writeFileSync(this.indexPath, JSON.stringify({ meta: this.data.meta, totalChunks: this.data.chunks.length }), 'utf-8')

              // Write chunks in separate files
              for (let i = 0; i < this.data.chunks.length; i += this.CHUNKS_PER_FILE) {
                const batch = this.data.chunks.slice(i, i + this.CHUNKS_PER_FILE)
                const chunkFile = path.join(this.indexDir, `chunks-${Math.floor(i / this.CHUNKS_PER_FILE)}.json`)
                fs.writeFileSync(chunkFile, JSON.stringify(batch), 'utf-8')
              }
            } catch (e: any) {
              console.error('[indexer] Failed to save incremental update:', e)
            }
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
