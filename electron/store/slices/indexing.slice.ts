/**
 * Indexing Slice
 *
 * Manages code indexing and semantic search.
 *
 * Responsibilities:
 * - Track index status (ready, chunks, model)
 * - Manage index building/rebuilding
 * - Handle search queries and results
 * - Subscribe to index progress updates
 * - Clear index when needed
 *
 * Dependencies:
 * - Workspace slice (for workspace root)
 */

import type { StateCreator } from 'zustand'
import type { IndexStatus, IndexProgress } from '../types'

import { getIndexer } from '../../core/state'

// ============================================================================
// Types
// ============================================================================

export type IndexSearchResult = {
  path: string
  startLine: number
  endLine: number
  text: string
}

// Auto-refresh configuration for semantic index maintenance
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

export interface IndexingSlice {
  // State
  idxStatus: IndexStatus | null
  idxLoading: boolean
  idxQuery: string
  idxResults: IndexSearchResult[]
  idxProg: IndexProgress | null

  // Auto-refresh settings and telemetry
  idxAutoRefresh: AutoRefreshConfig
  idxLastRebuildAt?: number
  idxRebuildTimestamps?: number[]
  idxLastScanAt?: number
  idxLastFileCount?: number
  // Shared promise to dedupe concurrent rebuilds
  idxRebuildPromise?: Promise<void>

  // Actions
  ensureIndexProgressSubscription: () => void
  refreshIndexStatus: () => Promise<void>
  // Heuristics-based rebuild (blocking): triggers rebuild if needed and waits until complete
  maybeAutoRebuildAndWait: () => Promise<{ triggered: boolean }>
  rebuildIndex: () => Promise<{ ok: boolean; status?: IndexStatus | null; error?: unknown } | undefined>
  clearIndex: () => Promise<{ ok: boolean } | undefined>
  cancelIndexing: () => Promise<void>
  setIdxQuery: (q: string) => void
  searchIndex: () => Promise<void>
  setIndexAutoRefresh: (params: { config: Partial<AutoRefreshConfig> }) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createIndexingSlice: StateCreator<IndexingSlice, [], [], IndexingSlice> = (set, get) => ({
  // State
  idxStatus: null,
  idxLoading: false,
  idxQuery: '',
  idxResults: [],
  idxProg: null,

  // Auto-refresh settings and telemetry
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
  idxRebuildPromise: undefined as any,


  // Actions
  setIndexAutoRefresh: ({ config }: { config: Partial<AutoRefreshConfig> }) => {
    set((state: any) => ({ idxAutoRefresh: { ...state.idxAutoRefresh, ...config } }))
  },

  ensureIndexProgressSubscription: (() => {
    // In main-process store, we attach a single file-watcher progress callback once.
    let started = false
    return () => {
      if (started) return
      started = true
      // Best-effort: start watch so incremental changes update progress/status
      getIndexer()
        .then((indexer) => {
          try {
            indexer.startWatch((p) => {
              set({
                idxProg: {
                  inProgress: p.inProgress,
                  phase: p.phase,
                  processedFiles: p.processedFiles,
                  totalFiles: p.totalFiles,
                  processedChunks: p.processedChunks,
                  totalChunks: p.totalChunks,
                  elapsedMs: p.elapsedMs,
                } as IndexProgress,
                idxStatus: {
                  ready: p.ready,
                  chunks: p.chunks,
                  modelId: p.modelId,
                  dim: p.dim,
                  indexPath: p.indexPath,
                } as IndexStatus,
              })
            })
          } catch {}
        })
        .catch(() => {})
    }
  })(),

  refreshIndexStatus: async () => {
    try {
      const indexer = await getIndexer()
      const s = indexer.status()
      set({
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
  },
  maybeAutoRebuildAndWait: async () => {
    try {
      const cfg = get().idxAutoRefresh
      if (!cfg?.enabled) return { triggered: false }

      const indexer = await getIndexer()
      const s = indexer.status()
      console.log(`[indexing] gate status: ready=${s.ready} chunks=${s.chunks} modelId=${s.modelId} dim=${s.dim} inProgress=${s.inProgress} exists=${s.exists} indexPath=${s.indexPath}`)

      // Compute gating times
      const now = Date.now()
      const last = get().idxLastRebuildAt || 0
      const minIntervalMs = Math.max(1, cfg.minIntervalMinutes || 0) * 60_000

      // Decide if rebuild is needed (conservative + first-run + model-change):
      // - No index or zero chunks (always rebuild regardless of min interval)
      // - First run (no last rebuild recorded)
      // - Embedding model changed (id or dim)
      // - TTL expired since last rebuild
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
            console.log(`[indexing] gate reason: model changed (meta ${s.modelId}/${s.dim} -> engine ${ei.id}/${ei.dim})`)
            should = true
          }
        } catch {}
      }

      const ttlMs = Math.max(1, cfg.ttlMinutes || 0) * 60_000
      if (!should && last > 0 && (now - last) > ttlMs) {
        console.log(`[indexing] gate reason: TTL expired last=${new Date(last).toISOString()} ttlMinutes=${cfg.ttlMinutes}`)
        should = true
      }

      // Treat suspiciously small indexes as unusable (e.g., meta exists but chunks are implausibly low)
      const lastFileCount = (get() as any).idxLastFileCount || 0
      // Suspicious small only triggers for larger workspaces (avoid thrash on small repos)
      const suspiciousSmall = (s.chunks || 0) > 0 && (lastFileCount >= 200) && ((s.chunks || 0) < 100)
      if (!should && suspiciousSmall) {
        console.log(`[indexing] gate reason: suspiciousSmall chunks=${s.chunks} lastFileCount=${lastFileCount}`)
        should = true
      }

      // Respect minInterval ONLY when the index is already ready (to avoid thrashing)
      const withinMin = last > 0 && (now - last) < minIntervalMs
      if (should && withinMin && s.ready && !suspiciousSmall) {
        console.log(`[indexing] gate bypassed by minInterval: last=${new Date(last).toISOString()} minIntervalMinutes=${cfg.minIntervalMinutes}`)
        return { triggered: false }
      }

      // If a rebuild is already running, do not start a second one
      if (!should) return { triggered: false }
      if (s.inProgress) return { triggered: false }

      // Prevent concurrent rebuilds by sharing a promise
      let shared: Promise<void> | undefined = (get() as any).idxRebuildPromise
      if (shared) {
        await shared
        return { triggered: true }
      }

      const stateAny = get() as any
      let lastMsgAt = 0

      const rebuildPromise = (async () => {
        try {
          const t0 = Date.now()
          console.time('[indexing] rebuild')
          stateAny.setStartupMessage?.('Indexing workspace...')
          await indexer.rebuild((p) => {
            // Update progress state
            set({
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
            const now2 = Date.now()
            if (now2 - lastMsgAt > 500) {
              lastMsgAt = now2
              const phase = p.phase || 'scanning'
              const pf = p.processedFiles ?? 0
              const tf = p.totalFiles ?? 0
              const pc = p.processedChunks ?? 0
              const tc = p.totalChunks ?? 0
              const msg = `Indexing (${phase}): files ${pf}/${tf}, chunks ${pc}/${tc}`
              stateAny.setStartupMessage?.(msg)
            }
          })

          // After rebuild, set watch and update status
          try { indexer.startWatch(() => {}) } catch {}
          const ns = indexer.status()
          set({
            idxStatus: { ready: ns.ready, chunks: ns.chunks, modelId: ns.modelId, dim: ns.dim, indexPath: ns.indexPath },
            idxLastRebuildAt: Date.now(),
            idxRebuildTimestamps: [...(get().idxRebuildTimestamps || []), Date.now()],
            idxLastFileCount: ns.totalFiles,
          })
          const dt = Math.max(1, Date.now() - t0) / 1000
          const filesPerSec = ((ns.totalFiles || 0) / dt).toFixed(2)
          const chunksPerSec = ((ns.totalChunks || 0) / dt).toFixed(2)
          console.timeEnd('[indexing] rebuild')
          console.log(`[indexing] throughput: ${ns.totalFiles || 0} files in ${dt.toFixed(2)}s (${filesPerSec} files/s), ${ns.totalChunks || 0} chunks (${chunksPerSec} chunks/s)`)
        } finally {
          set({ idxRebuildPromise: undefined } as any)
        }
      })()

      set({ idxRebuildPromise: rebuildPromise } as any)
      await rebuildPromise
      return { triggered: true }
    } catch (e) {
      console.error('[indexing] maybeAutoRebuildAndWait error:', e)
      return { triggered: false }
    }
  },

  rebuildIndex: async () => {
    set({ idxLoading: true })
    try {
      const indexer = await getIndexer()
      await indexer.rebuild((p) => {
        set({
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
          set({
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
      } catch {}
      const s = indexer.status()
      set({
        idxStatus: { ready: s.ready, chunks: s.chunks, modelId: s.modelId, dim: s.dim, indexPath: s.indexPath },
      })
      return { ok: true, status: { ready: s.ready, chunks: s.chunks, modelId: s.modelId, dim: s.dim, indexPath: s.indexPath } as IndexStatus }
    } catch (e) {
      console.error('[indexing] Index rebuild error:', e)
      return { ok: false, error: e }
    } finally {
      set({ idxLoading: false })
    }
  },

  cancelIndexing: async () => {
    try {
      const indexer = await getIndexer()
      indexer.cancel()
      const s = indexer.status()
      set({
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
  },


  clearIndex: async () => {
    try {
      const indexer = await getIndexer()
      indexer.clear()
      const s = indexer.status()
      set({
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
  },

  setIdxQuery: (q: string) => {
    set({ idxQuery: q })
  },

  searchIndex: async () => {
    const state = get()
    const query = state.idxQuery.trim()
    if (!query) { set({ idxResults: [] }); return }
    try {
      const indexer = await getIndexer()
      const res = await indexer.search(query, 20)
      const results = res?.chunks || []
      set({ idxResults: results })
    } catch (e) {
      console.error('[indexing] Search error:', e)
      set({ idxResults: [] })
    }
  },
})

