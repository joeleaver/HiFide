/**
 * Indexing Service
 * 
 * Manages code indexing and semantic search.
 */

import { Service } from './base/Service.js'
import type { IndexStatus, IndexProgress } from '../store/types.js'
import { getIndexer } from '../core/state.js'

// Shallow equality to avoid spamming setState with identical values
function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a[k] !== (b as any)[k]) return false
  }
  return true
}

export type IndexSearchResult = {
  path: string
  startLine: number
  endLine: number
  text: string
}

export type AutoRefreshConfig = {
  enabled: boolean
  ttlMinutes: number
  minIntervalMinutes: number
  changeAbsoluteThreshold: number
  changePercentThreshold: number
  lockfileTrigger: boolean
  lockfileGlobs: string[]
  modelChangeTrigger: boolean
  maxRebuildsPerHour: number
}

interface IndexingState {
  idxStatus: IndexStatus | null
  idxLoading: boolean
  idxQuery: string
  idxResults: IndexSearchResult[]
  idxProg: IndexProgress | null
  idxBackgroundActive: boolean
  idxBackgroundProgress: IndexProgress | null
  idxBackgroundVersion: string | null
  idxAutoRefresh: AutoRefreshConfig
  idxLastRebuildAt?: number
  idxRebuildTimestamps?: number[]
  idxLastScanAt?: number
  idxLastFileCount?: number
  idxRebuildPromise?: Promise<void>
}

export class IndexingService extends Service<IndexingState> {
  private progressSubscriptionStarted = false

  constructor() {
    super({
      idxStatus: null,
      idxLoading: false,
      idxQuery: '',
      idxResults: [],
      idxProg: null,
      idxBackgroundActive: false,
      idxBackgroundProgress: null,
      idxBackgroundVersion: null,
      idxAutoRefresh: {
        enabled: true,
        ttlMinutes: 120,
        minIntervalMinutes: 10,
        changeAbsoluteThreshold: 100,
        changePercentThreshold: 0.02,
        lockfileTrigger: true,
        lockfileGlobs: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
        modelChangeTrigger: true,
        maxRebuildsPerHour: 3,
      },
      idxLastRebuildAt: undefined,
      idxRebuildTimestamps: [],
      idxLastScanAt: undefined,
      idxLastFileCount: undefined,
      idxRebuildPromise: undefined,
    })
  }

  protected onStateChange(): void {
    // Indexing state is transient, no persistence needed
  }

  // Getters
  getStatus(): IndexStatus | null {
    return this.state.idxStatus
  }

  isLoading(): boolean {
    return this.state.idxLoading
  }

  getQuery(): string {
    return this.state.idxQuery
  }

  getResults(): IndexSearchResult[] {
    return this.state.idxResults
  }

  getProgress(): IndexProgress | null {
    return this.state.idxProg
  }

  isBackgroundActive(): boolean {
    return this.state.idxBackgroundActive
  }

  getBackgroundProgress(): IndexProgress | null {
    return this.state.idxBackgroundProgress
  }

  getBackgroundVersion(): string | null {
    return this.state.idxBackgroundVersion
  }

  getAutoRefresh(): AutoRefreshConfig {
    return this.state.idxAutoRefresh
  }

  getLastRebuildAt(): number | undefined {
    return this.state.idxLastRebuildAt
  }

  getRebuildTimestamps(): number[] | undefined {
    return this.state.idxRebuildTimestamps
  }

  getLastScanAt(): number | undefined {
    return this.state.idxLastScanAt
  }

  getLastFileCount(): number | undefined {
    return this.state.idxLastFileCount
  }

  // Setters
  setIdxQuery(q: string): void {
    this.setState({ idxQuery: q })
  }

  setIndexAutoRefresh(params: { config: Partial<AutoRefreshConfig> }): void {
    this.setState({ idxAutoRefresh: { ...this.state.idxAutoRefresh, ...params.config } })
  }

  // Progress subscription
  ensureIndexProgressSubscription(): void {
    if (this.progressSubscriptionStarted) return
    this.progressSubscriptionStarted = true

    // Best-effort: start watch so incremental changes update progress/status
    getIndexer()
      .then((indexer) => {
        try {
          indexer.startWatch((p) => {
            const nextProg: IndexProgress = {
              inProgress: p.inProgress,
              phase: p.phase,
              processedFiles: p.processedFiles,
              totalFiles: p.totalFiles,
              processedChunks: p.processedChunks,
              totalChunks: p.totalChunks,
              elapsedMs: p.elapsedMs,
            }
            const nextStatus: IndexStatus = {
              ready: p.ready,
              chunks: p.chunks,
              modelId: p.modelId,
              dim: p.dim,
              indexPath: p.indexPath,
            }
            if (shallowEqual(this.state.idxProg, nextProg) && shallowEqual(this.state.idxStatus, nextStatus)) return
            this.setState({ idxProg: nextProg, idxStatus: nextStatus })
          })
        } catch {}
      })
      .catch(() => {})
  }

  async refreshIndexStatus(): Promise<void> {
    try {
      const indexer = await getIndexer()
      const s = indexer.status()
      this.setState({
        idxStatus: {
          ready: s.ready,
          chunks: s.chunks,
          modelId: s.modelId,
          dim: s.dim,
          indexPath: s.indexPath,
        },
        idxProg: {
          inProgress: s.inProgress,
          phase: s.phase,
          processedFiles: s.processedFiles,
          totalFiles: s.totalFiles,
          processedChunks: s.processedChunks,
          totalChunks: s.totalChunks,
          elapsedMs: s.elapsedMs,
        },
        idxLastFileCount: s.totalFiles,
      })
    } catch (e) {
      console.error('[indexing] Failed to refresh status:', e)
    }
  }

  async searchIndex(): Promise<void> {
    const query = this.state.idxQuery.trim()
    if (!query) {
      this.setState({ idxResults: [] })
      return
    }
    try {
      const indexer = await getIndexer()
      const res = await indexer.search(query, 20)
      const results = res?.chunks || []
      this.setState({ idxResults: results })
    } catch (e) {
      console.error('[indexing] Search error:', e)
      this.setState({ idxResults: [] })
    }
  }

  async clearIndex(): Promise<{ ok: boolean }> {
    try {
      const indexer = await getIndexer()
      indexer.clear()
      const s = indexer.status()
      this.setState({
        idxStatus: { ready: s.ready, chunks: s.chunks, modelId: s.modelId, dim: s.dim, indexPath: s.indexPath },
        idxProg: {
          inProgress: s.inProgress,
          phase: s.phase,
          processedFiles: s.processedFiles,
          totalFiles: s.totalFiles,
          processedChunks: s.processedChunks,
          totalChunks: s.totalChunks,
          elapsedMs: s.elapsedMs,
        },
      })
      return { ok: true }
    } catch (e) {
      console.error('[indexing] Failed to clear index:', e)
      return { ok: false }
    }
  }

  async cancelIndexing(): Promise<void> {
    try {
      const indexer = await getIndexer()
      indexer.cancel()
      const s = indexer.status()
      this.setState({
        idxProg: {
          inProgress: s.inProgress,
          phase: s.phase,
          processedFiles: s.processedFiles,
          totalFiles: s.totalFiles,
          processedChunks: s.processedChunks,
          totalChunks: s.totalChunks,
          elapsedMs: s.elapsedMs,
        },
      })
    } catch {}
  }

  async rebuildIndex(): Promise<{ ok: boolean; status?: IndexStatus | null; error?: unknown } | undefined> {
    this.setState({ idxLoading: true })
    try {
      const indexer = await getIndexer()
      await indexer.rebuild((p) => {
        this.setState({
          idxProg: {
            inProgress: p.inProgress,
            phase: p.phase,
            processedFiles: p.processedFiles,
            totalFiles: p.totalFiles,
            processedChunks: p.processedChunks,
            totalChunks: p.totalChunks,
            elapsedMs: p.elapsedMs,
          },
          idxStatus: {
            ready: p.ready,
            chunks: p.chunks,
            modelId: p.modelId,
            dim: p.dim,
            indexPath: p.indexPath,
          },
        })
      })
      // Begin watching for incremental changes
      try {
        indexer.startWatch((p) => {
          const nextProg: IndexProgress = {
            inProgress: p.inProgress,
            phase: p.phase,
            processedFiles: p.processedFiles,
            totalFiles: p.totalFiles,
            processedChunks: p.processedChunks,
            totalChunks: p.totalChunks,
            elapsedMs: p.elapsedMs,
          }
          const nextStatus: IndexStatus = {
            ready: p.ready,
            chunks: p.chunks,
            modelId: p.modelId,
            dim: p.dim,
            indexPath: p.indexPath,
          }
          if (shallowEqual(this.state.idxProg, nextProg) && shallowEqual(this.state.idxStatus, nextStatus)) return
          this.setState({ idxProg: nextProg, idxStatus: nextStatus })
        })
      } catch {}
      const s = indexer.status()
      this.setState({
        idxStatus: { ready: s.ready, chunks: s.chunks, modelId: s.modelId, dim: s.dim, indexPath: s.indexPath },
      })
      return {
        ok: true,
        status: { ready: s.ready, chunks: s.chunks, modelId: s.modelId, dim: s.dim, indexPath: s.indexPath } as IndexStatus,
      }
    } catch (e) {
      const msg = (e && (e as any).message) ? (e as any).message : String(e)
      console.error('[indexing] Index rebuild error:', e)
      if (/(sharp|vips|ERR_DLOPEN_FAILED|node-gyp|node-pre-gyp|onnxruntime)/i.test(msg)) {
        console.warn(
          '[indexing] Prerequisite not ready for semantic indexing (native dep). On Windows/Electron dev: run "pnpm rebuild sharp" then "pnpm exec electron-rebuild -f -w sharp". If onnxruntime errors persist, the engine now prefers the WASM backend automatically.'
        )
      }
      return { ok: false, error: e }
    } finally {
      this.setState({ idxLoading: false })
    }
  }

  async startBackgroundRebuild(params: { priority?: 'high' | 'low' } = {}): Promise<void> {
    const { priority = 'low' } = params
    try {
      const indexer = await getIndexer()

      // Don't start if already running
      if (this.state.idxBackgroundActive) {
        console.log('[indexing] Background rebuild already in progress')
        return
      }

      // Create new version directory
      const newVersion = `v${Date.now()}`
      const versionInfo = indexer.getVersionInfo()
      const path = await import('node:path')
      const newIndexDir = path.join(versionInfo.versionsDir, newVersion)

      console.log(`[indexing] Starting background rebuild to ${newVersion} (priority: ${priority})`)

      this.setState({
        idxBackgroundActive: true,
        idxBackgroundVersion: newVersion,
        idxBackgroundProgress: {
          inProgress: true,
          phase: 'scanning',
          processedFiles: 0,
          totalFiles: 0,
          processedChunks: 0,
          totalChunks: 0,
          elapsedMs: 0,
        },
      })

      // Build into new directory (doesn't touch active index)
      await indexer.rebuildToDirectory(newIndexDir, (progress) => {
        // Update background progress
        this.setState({
          idxBackgroundProgress: {
            inProgress: progress.inProgress,
            phase: progress.phase,
            processedFiles: progress.processedFiles,
            totalFiles: progress.totalFiles,
            processedChunks: progress.processedChunks,
            totalChunks: progress.totalChunks,
            elapsedMs: progress.elapsedMs,
          },
        })
      })

      // Atomic swap to new index
      await indexer.swapToNewIndex(newVersion)

      // Update status to reflect new index
      const s = indexer.status()
      this.setState({
        idxStatus: {
          ready: s.ready,
          chunks: s.chunks,
          modelId: s.modelId,
          dim: s.dim,
          indexPath: s.indexPath,
        },
        idxLastRebuildAt: Date.now(),
      })

      // Clean up old versions (keep last 2)
      await indexer.cleanupOldVersions({ keep: 2 })

      console.log(`[indexing] Background rebuild complete: ${newVersion}`)
    } catch (e) {
      console.error('[indexing] Background rebuild failed:', e)
    } finally {
      this.setState({
        idxBackgroundActive: false,
        idxBackgroundProgress: null,
        idxBackgroundVersion: null,
      })
    }
  }

  async maybeAutoRebuildAndWait(): Promise<{ triggered: boolean }> {
    try {
      const cfg = this.state.idxAutoRefresh
      if (!cfg?.enabled) return { triggered: false }

      const indexer = await getIndexer()
      const s = indexer.status()
      console.log(
        `[indexing] gate status: ready=${s.ready} chunks=${s.chunks} modelId=${s.modelId} dim=${s.dim} inProgress=${s.inProgress} exists=${s.exists} indexPath=${s.indexPath}`
      )

      // Compute gating times
      const now = Date.now()
      const last = this.state.idxLastRebuildAt || 0
      const minIntervalMs = Math.max(1, cfg.minIntervalMinutes || 0) * 60_000

      // Decide if rebuild is needed
      let should = false
      if (!s.ready || (s.chunks || 0) === 0) should = true

      if (!should && last === 0) {
        console.log('[indexing] gate reason: first-run (no idxLastRebuildAt)')
        should = true
      }

      if (!should && cfg.modelChangeTrigger) {
        try {
          const ei = await indexer.getEngineInfo()
          if (s.modelId && s.dim && (ei.id !== s.modelId || ei.dim !== s.dim)) {
            console.log(
              `[indexing] gate reason: model changed (meta ${s.modelId}/${s.dim} -> engine ${ei.id}/${ei.dim})`
            )
            should = true
          }
        } catch {}
      }

      const ttlMs = Math.max(1, cfg.ttlMinutes || 0) * 60_000
      if (!should && last > 0 && now - last > ttlMs) {
        console.log(
          `[indexing] gate reason: TTL expired last=${new Date(last).toISOString()} ttlMinutes=${cfg.ttlMinutes}`
        )
        should = true
      }

      // Treat suspiciously small indexes as unusable
      const lastFileCount = this.state.idxLastFileCount || 0
      const suspiciousSmall = (s.chunks || 0) > 0 && lastFileCount >= 200 && (s.chunks || 0) < 100
      if (!should && suspiciousSmall) {
        console.log(`[indexing] gate reason: suspiciousSmall chunks=${s.chunks} lastFileCount=${lastFileCount}`)
        should = true
      }

      // Respect minInterval ONLY when the index is already ready
      const withinMin = last > 0 && now - last < minIntervalMs
      if (should && withinMin && s.ready && !suspiciousSmall) {
        console.log(
          `[indexing] gate bypassed by minInterval: last=${new Date(last).toISOString()} minIntervalMinutes=${cfg.minIntervalMinutes}`
        )
        return { triggered: false }
      }

      // If a rebuild is already running, do not start a second one
      if (!should) return { triggered: false }
      if (s.inProgress) return { triggered: false }

      // Prevent concurrent rebuilds by sharing a promise
      let shared: Promise<void> | undefined = this.state.idxRebuildPromise
      if (shared) {
        await shared
        return { triggered: true }
      }

      let lastMsgAt = 0

      const rebuildPromise = (async () => {
        try {
          const t0 = Date.now()
          console.time('[indexing] rebuild')
          const appService = (await import('./index.js')).getAppService?.()
          appService?.setStartupMessage('Indexing workspace...')
          await indexer.rebuild((p) => {
            // Update progress state
            const nextProg: IndexProgress = {
              inProgress: p.inProgress,
              phase: p.phase,
              processedFiles: p.processedFiles,
              totalFiles: p.totalFiles,
              processedChunks: p.processedChunks,
              totalChunks: p.totalChunks,
              elapsedMs: p.elapsedMs,
            }
            const nextStatus: IndexStatus = {
              ready: p.ready,
              chunks: p.chunks,
              modelId: p.modelId,
              dim: p.dim,
              indexPath: p.indexPath,
            }
            if (!shallowEqual(this.state.idxProg, nextProg) || !shallowEqual(this.state.idxStatus, nextStatus)) {
              this.setState({ idxProg: nextProg, idxStatus: nextStatus })
            }
            const now2 = Date.now()
            if (now2 - lastMsgAt > 500) {
              lastMsgAt = now2
              const phase = p.phase || 'scanning'
              const pf = p.processedFiles ?? 0
              const tf = p.totalFiles ?? 0
              const pc = p.processedChunks ?? 0
              const tc = p.totalChunks ?? 0
              const msg = `Indexing (${phase}): files ${pf}/${tf}, chunks ${pc}/${tc}`
              appService?.setStartupMessage(msg)
            }
          })

          // After rebuild, set watch and update status
          try {
            indexer.startWatch(() => {})
          } catch {}
          const ns = indexer.status()
          this.setState({
            idxStatus: {
              ready: ns.ready,
              chunks: ns.chunks,
              modelId: ns.modelId,
              dim: ns.dim,
              indexPath: ns.indexPath,
            },
            idxLastRebuildAt: Date.now(),
            idxRebuildTimestamps: [...(this.state.idxRebuildTimestamps || []), Date.now()],
            idxLastFileCount: ns.totalFiles,
          })
          const dt = Math.max(1, Date.now() - t0) / 1000
          const filesPerSec = ((ns.totalFiles || 0) / dt).toFixed(2)
          const chunksPerSec = ((ns.totalChunks || 0) / dt).toFixed(2)
          console.timeEnd('[indexing] rebuild')
          console.log(
            `[indexing] throughput: ${ns.totalFiles || 0} files in ${dt.toFixed(2)}s (${filesPerSec} files/s), ${ns.totalChunks || 0} chunks (${chunksPerSec} chunks/s)`
          )
        } finally {
          this.setState({ idxRebuildPromise: undefined })
        }
      })()

      this.setState({ idxRebuildPromise: rebuildPromise })
      await rebuildPromise
      return { triggered: true }
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error('[indexing] maybeAutoRebuildAndWait error:', e)
      if (/(sharp|vips|ERR_DLOPEN_FAILED|node-gyp|node-pre-gyp|onnxruntime)/i.test(msg)) {
        console.warn(
          '[indexing] Prerequisite not ready for semantic indexing (native dep). On Windows/Electron dev: run "pnpm rebuild sharp" then "pnpm exec electron-rebuild -f -w sharp". If onnxruntime errors persist, the engine now prefers the WASM backend automatically.'
        )
      }
      return { triggered: false }
    }
  }
}

