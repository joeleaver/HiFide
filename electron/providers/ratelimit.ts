import Store from 'electron-store'
import { app } from 'electron'

export type RateLimitKind = {
  rpm?: number // requests per minute
  tpmTotal?: number // total tokens per minute (input+output)
  tpmInput?: number // input tokens per minute
  tpmOutput?: number // output tokens per minute
  maxConcurrent?: number // max concurrent in-flight requests
}

export type ProviderModelKey = { provider: string; model: string }

export type RateLimitConfig = {
  enabled: boolean
  openai?: Record<string, RateLimitKind>
  anthropic?: Record<string, RateLimitKind>
  gemini?: Record<string, RateLimitKind>
}

// Rolling window helper
function nowMs() { return Date.now() }
const MINUTE = 60_000

class RateLimiterInternal {
  private store?: Store<{ config: RateLimitConfig }>
  private config: RateLimitConfig = { enabled: false }
  private loadedFromStore = false
  private ensureStore() {
    if (!this.store) {
      this.store = new Store<{ config: RateLimitConfig }>({ name: 'hifide-ratelimits' })
    }
    if (!this.loadedFromStore) {
      try { this.config = (this.store.get('config') || { enabled: false }) } catch {}
      this.loadedFromStore = true
    }
  }

  // per (provider,model) state
  private inflight = new Map<string, number>() // key -> count
  private reqStarts = new Map<string, number[]>() // timestamps of starts (ms)
  private tokEvents = new Map<string, Array<{ ts: number; inTok: number; outTok: number }>>()

  // Waiters per key
  private waiters = new Map<string, Array<() => void>>()

  getConfig() { try { if (app?.isReady?.()) this.ensureStore() } catch {}; return this.config }

  setConfig(cfg: RateLimitConfig) {
    this.config = cfg || { enabled: false }
    try { if (app?.isReady?.()) { this.ensureStore(); this.store!.set('config', this.config) } } catch {}
    // Wake any waiters to re-evaluate with new config
    for (const [, list] of this.waiters) list.forEach(fn => { try { fn() } catch {} })
  }

  private key(pm: ProviderModelKey) { return `${pm.provider}::${pm.model || 'default'}` }

  private limitsFor(pm: ProviderModelKey): RateLimitKind | undefined {
    const prov = (this.config as any)[pm.provider] || {}
    return prov[pm.model] || prov['default']
  }

  private prune(pmKey: string) {
    const t = nowMs()
    const starts = this.reqStarts.get(pmKey) || []
    const prunedStarts = starts.filter(ts => t - ts < MINUTE)
    if (prunedStarts.length !== starts.length) this.reqStarts.set(pmKey, prunedStarts)

    const tok = this.tokEvents.get(pmKey) || []
    const prunedTok = tok.filter(ev => t - ev.ts < MINUTE)
    if (prunedTok.length !== tok.length) this.tokEvents.set(pmKey, prunedTok)
  }

  private currentUsage(pmKey: string) {
    this.prune(pmKey)
    const starts = this.reqStarts.get(pmKey) || []
    const tok = this.tokEvents.get(pmKey) || []
    const inTok = tok.reduce((n, ev) => n + ev.inTok, 0)
    const outTok = tok.reduce((n, ev) => n + ev.outTok, 0)
    const totalTok = inTok + outTok
    const concurrent = this.inflight.get(pmKey) || 0
    return { rpm: starts.length, inTok, outTok, totalTok, concurrent }
  }

  // Wait until all active limits are satisfied
  private async waitUntilAllowed(pm: ProviderModelKey) {
    if (!this.config?.enabled) return
    const lim = this.limitsFor(pm)
    if (!lim) return

    const pmKey = this.key(pm)

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const u = this.currentUsage(pmKey)
      const blocks: Array<{ untilMs: number }> = []

      if (typeof lim.maxConcurrent === 'number' && lim.maxConcurrent > 0 && u.concurrent >= lim.maxConcurrent) {
        // wait until any current inflight finishes; we don't track timestamps per inflight, just wait for a signal
        blocks.push({ untilMs: nowMs() + 250 })
      }
      if (typeof lim.rpm === 'number' && lim.rpm > 0 && u.rpm >= lim.rpm) {
        const starts = this.reqStarts.get(pmKey) || []
        const earliest = starts[0] || nowMs()
        blocks.push({ untilMs: earliest + MINUTE + 5 })
      }
      if (typeof lim.tpmTotal === 'number' && lim.tpmTotal > 0 && u.totalTok >= lim.tpmTotal) {
        const tok = this.tokEvents.get(pmKey) || []
        const earliest = tok[0]?.ts || nowMs()
        blocks.push({ untilMs: earliest + MINUTE + 5 })
      }
      if (typeof lim.tpmInput === 'number' && lim.tpmInput > 0 && u.inTok >= lim.tpmInput) {
        const tok = this.tokEvents.get(pmKey) || []
        const earliest = tok[0]?.ts || nowMs()
        blocks.push({ untilMs: earliest + MINUTE + 5 })
      }
      if (typeof lim.tpmOutput === 'number' && lim.tpmOutput > 0 && u.outTok >= lim.tpmOutput) {
        const tok = this.tokEvents.get(pmKey) || []
        const earliest = tok[0]?.ts || nowMs()
        blocks.push({ untilMs: earliest + MINUTE + 5 })
      }

      if (blocks.length === 0) return

      const waitMs = Math.max(0, Math.min(...blocks.map(b => b.untilMs - nowMs())))
      await new Promise<void>((resolve) => {
        // register waiter and also fallback timeout
        const arr = this.waiters.get(pmKey) || []
        arr.push(resolve)
        this.waiters.set(pmKey, arr)
        setTimeout(() => resolve(), Math.min(2000, Math.max(50, waitMs)))
      })
      // cleanup any resolved waiters
      this.waiters.set(pmKey, [])
    }
  }

  async acquire(pm: ProviderModelKey): Promise<() => void> {
    await this.waitUntilAllowed(pm)
    const pmKey = this.key(pm)
    // mark start
    const starts = this.reqStarts.get(pmKey) || []
    starts.push(nowMs())
    this.reqStarts.set(pmKey, starts)
    this.inflight.set(pmKey, (this.inflight.get(pmKey) || 0) + 1)

    let released = false
    return () => {
      if (released) return
      released = true
      const cur = (this.inflight.get(pmKey) || 1) - 1
      this.inflight.set(pmKey, Math.max(0, cur))
      // wake waiters to re-evaluate
      const list = this.waiters.get(pmKey) || []
      list.forEach(fn => { try { fn() } catch {} })
      this.waiters.set(pmKey, [])
    }
  }

  recordUsage(pm: ProviderModelKey, usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
    if (!this.config?.enabled) return
    const lim = this.limitsFor(pm)
    if (!lim) return
    const pmKey = this.key(pm)
    const list = this.tokEvents.get(pmKey) || []
    list.push({ ts: nowMs(), inTok: usage.inputTokens || 0, outTok: usage.outputTokens || 0 })
    this.tokEvents.set(pmKey, list)
    // prune and wake waiters
    this.prune(pmKey)
    const ws = this.waiters.get(pmKey) || []
    ws.forEach(fn => { try { fn() } catch {} })
    this.waiters.set(pmKey, [])
  }
}

export const rateLimiter = new RateLimiterInternal()

// IPC helpers (registered in main)
import type { IpcMain } from 'electron'
export function registerRateLimitIpc(ipcMain: IpcMain) {
  ipcMain.handle('ratelimits:get', async () => {
    return rateLimiter.getConfig()
  })
  ipcMain.handle('ratelimits:set', async (_e, cfg: RateLimitConfig) => {
    rateLimiter.setConfig(cfg)
    return { ok: true }
  })
}

