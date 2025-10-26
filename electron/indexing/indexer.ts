import fs from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'
import fg from 'fast-glob'
import os from 'node:os'
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
  private readonly CHUNKS_PER_FILE = 200 // Safer split: 200 chunks per file to reduce JSON size

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

  // gitignore filter (full semantics via ignore package)

  // Expose current engine info for gating decisions (model change trigger)
  public async getEngineInfo(): Promise<{ id: string; dim: number }> {
    if (!this.engine) this.engine = await getLocalEngine()
    return { id: this.engine!.id, dim: this.engine!.dim }
  }
  private ig: ReturnType<typeof ignore> | null = null

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

    // Read chunk count and meta from disk if available
    let chunkCount = 0
    let modelId: string | undefined
    let dim: number | undefined
    if (exists) {
      try {
        const metaRaw = fs.readFileSync(this.indexPath, 'utf-8')
        const parsed = JSON.parse(metaRaw)
        chunkCount = parsed.totalChunks || 0
        modelId = parsed.meta?.modelId
        dim = parsed.meta?.dim
      } catch {}
    }

    // Consider index ready when meta exists, at least one non-empty chunk file exists, chunkCount > 0, and not in progress
    let anyNonEmptyChunkOnDisk = false
    try {
      const files = fs.readdirSync(this.indexDir).filter((f) => f.startsWith('chunks-'))
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(this.indexDir, f))
          if (st.size > 2) { anyNonEmptyChunkOnDisk = true; break }
        } catch {}
      }
    } catch {}

    return {
      ready: exists && anyNonEmptyChunkOnDisk && chunkCount > 0 && !this.inProgress,
      chunks: chunkCount,
      modelId,
      dim,
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
    'node_modules','vendor','target','dist','build','out','dist-electron','release',
    '.git','.hifide-private','.hifide-public','.hifide_public','.next','.nuxt','.svelte-kit','.expo','.vercel',
    '.cache','.parcel-cache','.rollup.cache','.turbo','.yarn','.pnpm-store','.idea','.vscode',
    '.venv','venv','.pytest_cache','.mypy_cache','.gradle','jspm_packages','bower_components',
    'coverage','storybook-static','Pods'
  ])

  private defaultExcludedFiles = new Set([
    'package-lock.json','yarn.lock','pnpm-lock.yaml','Cargo.lock','Gemfile.lock',
    'poetry.lock','Pipfile.lock','composer.lock','go.sum'
  ])

  private loadGitIgnoreFilter() {
    this.ig = null
    try {
      const gi = fs.readFileSync(path.join(this.root, '.gitignore'), 'utf-8')
      const ig = ignore()
      ig.add(gi)
      this.ig = ig
    } catch { /* no gitignore */ }
  }

  private shouldSkip(filePath: string): boolean {
    const rel = path.relative(this.root, filePath)
    const relPosix = rel.split(path.sep).join('/')
    const base = path.basename(filePath)
    // skip if inside excluded dirs
    const parts = rel.split(path.sep)
    if (parts.some((p) => this.defaultExcludes.has(p))) return true
    // skip excluded filenames (lockfiles, etc.)
    if (this.defaultExcludedFiles.has(base)) return true
    if (this.ig && this.ig.ignores(relPosix)) return true

    const ext = path.extname(filePath).toLowerCase()
    const binExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.ico', '.dll', '.exe', '.mp4', '.mov', '.mp3', '.wav', '.ogg', '.webm', '.7z', '.rar', '.gz'])
    if (binExts.has(ext)) return true
    return false
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
    this.loadGitIgnoreFilter()
    this.inProgress = true
    this.cancelled = false
    this.progress = { phase: 'scanning', processedFiles: 0, totalFiles: 0, processedChunks: 0, totalChunks: 0, startedAt: Date.now() }
    onProgress?.(this.status())

    // Fast file discovery via fast-glob with standard ignores, then filter with gitignore/defaultExcludes
    const DEFAULT_EXCLUDE_GLOBS = [
      'node_modules/**','vendor/**','target/**','dist/**','build/**','out/**','dist-electron/**','release/**',
      '.git/**','.hifide-private/**','.hifide-public/**','.hifide_public/**','.next/**','.nuxt/**','.svelte-kit/**','.expo/**','.vercel/**',
      '.cache/**','.parcel-cache/**','.rollup.cache/**','.turbo/**','.yarn/**','.pnpm-store/**','.idea/**','.vscode/**',
      '.venv/**','venv/**','.pytest_cache/**','.mypy_cache/**','.gradle/**','jspm_packages/**','bower_components/**',
      'coverage/**','storybook-static/**','Pods/**'
    ]
    const candidates = fg.sync('**/*', { cwd: this.root, onlyFiles: true, dot: false, followSymbolicLinks: false, ignore: DEFAULT_EXCLUDE_GLOBS })
    const files = candidates
      .map((rel) => path.join(this.root, rel))
      .filter((f) => !this.shouldSkip(f))
    this.progress.totalFiles = files.length

    // Prepare for embedding + streaming write (single pass)
    this.progress.phase = 'embedding'
    this.progress.processedFiles = 0
    this.progress.processedChunks = 0
    onProgress?.(this.status())

    const meta: IndexMeta = { modelId: this.engine.id, dim: this.engine.dim, createdAt: Date.now() }

    // Clear old chunk files
    try {
      const oldFiles = fs.readdirSync(this.indexDir).filter(f => f.startsWith('chunks-'))
      for (const f of oldFiles) {
        try { fs.unlinkSync(path.join(this.indexDir, f)) } catch {}
      }
    } catch {}

    // Streaming writer state + serialized write queue
    let fileIndex = 0
    let countInFile = 0
    let ws: fs.WriteStream | null = null
    const DEBUG = process.env.HIFIDE_INDEX_DEBUG === '1'
    const openNewFile = () => {
      if (ws) return
      const chunkFile = path.join(this.indexDir, `chunks-${fileIndex}.json`)
      if (DEBUG) console.log(`[indexing] writer open ${path.basename(chunkFile)}`)
      ws = fs.createWriteStream(chunkFile, { encoding: 'utf-8' })
      ws.write('[')
      countInFile = 0
    }
    const closeFile = async () => {
      if (!ws) return
      ws.write(']')
      await new Promise<void>((resolve, reject) => { ws!.on('finish', () => resolve()); ws!.on('error', reject); ws!.end() })
      if (DEBUG) console.log(`[indexing] writer close fileIndex=${fileIndex} wrote=${countInFile}`)
      ws = null
      fileIndex++
    }
    let writeQ: Promise<void> = Promise.resolve()
    let pendingWrites = 0
    let writerFlushCount = 0
    let writerMaxPending = 0
    const enqueueWrite = (items: Chunk[]) => {
      pendingWrites++
      writerMaxPending = Math.max(writerMaxPending, pendingWrites)
      writeQ = writeQ.then(async () => {
        for (const item of items) {
          openNewFile()
          if (countInFile > 0) ws!.write(',')
          ws!.write(JSON.stringify(item))
          countInFile++
          this.progress.processedChunks++
          if (countInFile >= this.CHUNKS_PER_FILE) {
            await closeFile()
          }
        }
      }).finally(() => { pendingWrites-- })
      return writeQ
    }


    // Embedding concurrency telemetry
    let embedActive = 0
    let embedMaxActive = 0
    let embedBatchCount = 0
    const embedDurations: number[] = []




    // Engine-aware batching and limits
    const defaultBatch = this.engine.id.startsWith('fastembed-') ? 64 : 256

    // Fast-path: monolithic embed for small workspaces to eliminate per-call overhead
    const MONO_MAX_CHUNKS = Math.max(1, Number(process.env.HIFIDE_EMB_MONO_MAX || 256))

    const EMBED_BATCH_SIZE = Number(process.env.HIFIDE_EMB_BATCH_SIZE || defaultBatch)
    const MAX_FILE_BYTES = Number(process.env.HIFIDE_INDEX_MAX_FILE_BYTES || 2_000_000)
    const CPU = typeof os.cpus === 'function' ? os.cpus().length : 4
    const DEFAULT_CONCURRENCY = Math.min(8, Math.max(2, Math.floor(CPU / 2)))
    const CONCURRENCY = Math.max(1, Number(process.env.HIFIDE_INDEX_CONCURRENCY || DEFAULT_CONCURRENCY))


    // If small enough, do a single embed call across all chunks
    if (true) {
      try {
        let totalChunksLocal = 0
        const allRecords: { path: string; startLine: number; endLine: number; text: string }[] = []
        for (const f of files) {
          if (this.cancelled) return
          const relPath = path.relative(this.root, f)
          try {
            const st = await fs.promises.stat(f)
            if (st.size > MAX_FILE_BYTES) continue
            const text = await fs.promises.readFile(f, 'utf8').catch(() => '')
            if (!text) continue
            const parts = this.chunkText(text)
            totalChunksLocal += parts.length
            // Progress updates
            this.progress.totalChunks = totalChunksLocal
            this.progress.processedFiles = (this.progress.processedFiles || 0) + 1
            onProgress?.(this.status())
            for (const p of parts) {
              allRecords.push({ path: relPath, startLine: p.startLine, endLine: p.endLine, text: p.text })
            }
            if (totalChunksLocal > MONO_MAX_CHUNKS) {
              // Not small; fall back to normal pipeline
              break
            }
          } catch {}
        }

        if (totalChunksLocal <= MONO_MAX_CHUNKS) {
          // Single embed call for all texts
          const texts = allRecords.map(r => r.text)
          const t0 = Date.now()
          embedActive++; if (embedActive > embedMaxActive) embedMaxActive = embedActive
          const vectors = await this.engine!.embed(texts)
          embedActive--; embedBatchCount++
          const dt = Date.now() - t0
          embedDurations.push(dt)

          // Write all chunks in batches to avoid huge memory use in writer
          const WRITE_FLUSH_EVERY = Math.max(1, Number(process.env.HIFIDE_INDEX_WRITE_FLUSH_EVERY || 8))
          let flushCounter = 0
          const total = allRecords.length
          for (let i = 0; i < total; i += EMBED_BATCH_SIZE) {
            const recs = allRecords.slice(i, i + EMBED_BATCH_SIZE)
            const items: Chunk[] = recs.map((r, j) => ({ path: r.path, startLine: r.startLine, endLine: r.endLine, text: r.text, vector: vectors[i + j] }))
            enqueueWrite(items)
            flushCounter++
            if (flushCounter % WRITE_FLUSH_EVERY === 0) {
              writerFlushCount++
              await writeQ
            }
            onProgress?.(this.status())
          }
          await writeQ
          await closeFile()

          // Write metadata last so readers don't see incomplete chunks
          fs.writeFileSync(this.indexPath, JSON.stringify({ meta, totalChunks: total }), 'utf-8')

          // Concurrency summary
          console.log(`[indexing] concurrency: workers=1, maxActiveEmbeds=${embedMaxActive}, batches=${embedBatchCount}, avgEmbedMs=${(embedDurations.reduce((a,b)=>a+b,0)/(embedDurations.length||1)).toFixed(1)}, p95=${(() => {const s=[...embedDurations].sort((a,b)=>a-b); return s.length?s[Math.floor(0.95*(s.length-1))].toFixed(1):'0.0'})()}, writerFlushes=${writerFlushCount}, pendingWrites=${pendingWrites})`)

          // Mark done and publish final status before returning
          this.inProgress = false
          this.progress.phase = 'done'
          onProgress?.(this.status())
          return
        }
      } catch {}
    }


    console.log(`[indexing] using workers=${CONCURRENCY}, batch=${EMBED_BATCH_SIZE}, files=${files.length}`)

    // Periodic heartbeat to observe live concurrency and progress
    const HEARTBEAT_MS = Number(process.env.HIFIDE_INDEX_HEARTBEAT_MS || 2000)
    const hb: any = HEARTBEAT_MS > 0 ? setInterval(() => {
      const filesDone = this.progress.processedFiles || 0
      const chunksDone = this.progress.processedChunks || 0
      const chunksTotal = this.progress.totalChunks || 0
      console.log(`[indexing] hb: files ${filesDone}/${files.length}, chunks ${chunksDone}/${chunksTotal} embedActive=${embedActive} maxEmbed=${embedMaxActive} pendingWrites=${pendingWrites} writerFlushes=${writerFlushCount}`)
    }, HEARTBEAT_MS) : null
    hb?.unref?.()


    let totalChunks = 0
    let cur = 0
    const worker = async (wid: number) => {
      while (true) {
        if (this.cancelled) return
        const i = cur++
        if (i >= files.length) return
        const f = files[i]
        const relPath = path.relative(this.root, f)
        if (DEBUG) console.log(`[indexing] w${wid} file start ${relPath}`)
        // Size gate
        try {
          const st = await fs.promises.stat(f)
          if (!st.isFile() || st.size > MAX_FILE_BYTES) {
            if (DEBUG) console.log(`[indexing] w${wid} skip (size) ${relPath}`)
            this.progress.processedFiles++
            onProgress?.(this.status())
            continue
          }
        } catch {
          if (DEBUG) console.log(`[indexing] w${wid} skip (stat fail) ${relPath}`)
          this.progress.processedFiles++
          onProgress?.(this.status())
          continue
        }
        let text = ''
        try { text = await fs.promises.readFile(f, 'utf-8') } catch {
          if (DEBUG) console.log(`[indexing] w${wid} skip (read fail) ${relPath}`)
          this.progress.processedFiles++
          onProgress?.(this.status())
          continue
        // Record total chunks for throughput reporting

        // End record

        }
        const parts = this.chunkText(text)
        totalChunks += parts.length
        this.progress.totalChunks = totalChunks
        if (DEBUG) console.log(`[indexing] w${wid} chunks ${relPath} count=${parts.length}`)
        // Embedding batches
        // Embedding batches


        onProgress?.(this.status())

        // Embed in batches per file
        let flushCounter = 0
        const WRITE_FLUSH_EVERY = Math.max(1, Number(process.env.HIFIDE_INDEX_WRITE_FLUSH_EVERY || 8))
        for (let idx = 0; idx < parts.length; idx += EMBED_BATCH_SIZE) {
          if (this.cancelled) return
          const batch = parts.slice(idx, idx + EMBED_BATCH_SIZE)
          const t0 = Date.now()
          embedActive++; if (embedActive > embedMaxActive) embedMaxActive = embedActive
          const vectors = await this.engine!.embed(batch.map(p => p.text))
          embedActive--; embedBatchCount++
          const dt = Date.now() - t0
          embedDurations.push(dt)
          const items: Chunk[] = batch.map((p, j) => ({ path: relPath, startLine: p.startLine, endLine: p.endLine, text: p.text, vector: vectors[j] }))
          enqueueWrite(items)
          flushCounter++
          if (flushCounter % WRITE_FLUSH_EVERY === 0) {
            writerFlushCount++
            await writeQ
          }
          onProgress?.(this.status())
        }
        this.progress.processedFiles++
        if (DEBUG) console.log(`[indexing] w${wid} file done ${relPath}`)
        onProgress?.(this.status())
      }
    }

    // Launch workers
    await Promise.all(Array.from({ length: CONCURRENCY }, (_, id) => worker(id)))

    // Ensure all writes flushed and close last file
    await writeQ
    await closeFile()


    // Stop heartbeat logging
    if (hb) { try { clearInterval(hb) } catch {}
    }

    // Write metadata (after successful write of chunks)
    fs.writeFileSync(this.indexPath, JSON.stringify({ meta, totalChunks }), 'utf-8')

    // Concurrency summary
    const batches = embedBatchCount
    const avgMs = embedDurations.length ? (embedDurations.reduce((a, b) => a + b, 0) / embedDurations.length) : 0
    const sorted = embedDurations.slice().sort((a, b) => a - b)
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95) - 1] || sorted[sorted.length - 1] : 0
    console.log(`[indexing] concurrency: workers=${CONCURRENCY}, maxActiveEmbeds=${embedMaxActive}, batches=${batches}, avgEmbedMs=${avgMs.toFixed(1)}, p95=${p95.toFixed(1)}, writerFlushes=${writerFlushCount}, maxPendingWrites=${writerMaxPending}`)

    // Drop in-memory index to keep memory low
    this.data = null

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
        try {
          const chunkRaw = fs.readFileSync(path.join(this.indexDir, file), 'utf-8')
          // Skip obviously incomplete files (very short or missing closing bracket)
          if (!chunkRaw || chunkRaw.length < 2 || chunkRaw[0] !== '[' || chunkRaw[chunkRaw.length - 1] !== ']') {
            continue
          }
          const batch: Chunk[] = JSON.parse(chunkRaw)
          allChunks.push(...batch)
        } catch {
          // File may be mid-write; skip and continue
          continue
        }
      }

      this.data = { meta, chunks: allChunks }
    } catch (e) {
      console.error('[indexer] Failed to load index from disk:', e)
      // no-op
    }
  }

  async search(query: string, k = 8): Promise<{ chunks: Chunk[] }> {
    if (!this.engine) this.engine = await getLocalEngine()

    const [qv] = await this.engine.embed([query])

    // Stream over chunk files to avoid loading entire index in memory
    const chunkFiles = ((): string[] => {
      try {
        return fs.readdirSync(this.indexDir)
          .filter((f) => f.startsWith('chunks-'))
          .sort((a, b) => {
            const aNum = parseInt(a.replace('chunks-', '').replace('.json', ''))
            const bNum = parseInt(b.replace('chunks-', '').replace('.json', ''))
            return aNum - bNum
          })
      } catch {
        return []
      }
    })()

    // Maintain a simple top-k list
    const top: { c: Chunk; score: number }[] = []

    for (const file of chunkFiles) {
      let batch: Chunk[] = []
      try {
        const raw = fs.readFileSync(path.join(this.indexDir, file), 'utf-8')
        batch = JSON.parse(raw)
      } catch { continue }

      for (const c of batch) {
        const score = cosine(qv, c.vector)
        if (top.length < k) {
          top.push({ c, score })
          top.sort((a, b) => b.score - a.score)
        } else if (score > top[top.length - 1].score) {
          top[top.length - 1] = { c, score }
          top.sort((a, b) => b.score - a.score)
        }
      }
    }

    return { chunks: top.map((x) => x.c) }
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
            // Ignore changes inside our own index directory entirely
            if (abs.startsWith(this.indexDir + path.sep)) return
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

              // Write chunks in separate files first, then metadata (avoids meta pointing to partial files)
              for (let i = 0; i < this.data.chunks.length; i += this.CHUNKS_PER_FILE) {
                const batch = this.data.chunks.slice(i, i + this.CHUNKS_PER_FILE)
                const chunkFile = path.join(this.indexDir, `chunks-${Math.floor(i / this.CHUNKS_PER_FILE)}.json`)
                try {
                  fs.writeFileSync(chunkFile, JSON.stringify(batch), 'utf-8')
                } catch (e: any) {
                  // Fallback to streaming to avoid large in-memory JSON strings
                  try {
                    const ws = fs.createWriteStream(chunkFile, { encoding: 'utf-8' })
                    ws.write('[')
                    for (let k = 0; k < batch.length; k++) {
                      const s = JSON.stringify(batch[k])
                      ws.write(s)
                      if (k < batch.length - 1) ws.write(',')
                    }
                    ws.write(']')
                    await new Promise<void>((resolve, reject) => {
                      ws.on('finish', () => resolve())
                      ws.on('error', reject)
                      ws.end()
                    })
                  } catch (e2) {
                    console.error('[indexer] Incremental write stream failed:', (e2 as any)?.message)
                    throw e
                  }
                }
              }

              // Write metadata last so readers don't see incomplete chunks
              fs.writeFileSync(this.indexPath, JSON.stringify({ meta: this.data.meta, totalChunks: this.data.chunks.length }), 'utf-8')
              // Release in-memory index to avoid unbounded memory growth; rely on disk for subsequent reads
              this.data = null
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
