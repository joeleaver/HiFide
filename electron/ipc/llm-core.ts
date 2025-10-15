/**
 * Core LLM streaming and provider communication
 * 
 * Handles basic LLM streaming, provider management, and request tracking
 */

import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import { getWindow } from '../core/state'
import type { StreamHandle } from '../types'

/**
 * Inflight request tracking
 */
const inflight = new Map<string, StreamHandle>()

/**
 * Rate limit release tracking (per-request)
 */
const rateReleaseByRequest = new Map<string, () => void>()

/**
 * Reset inflight request
 */
export function resetInflight(requestId: string): void {
  const h = inflight.get(requestId)
  if (h) {
    try {
      h.cancel()
    } catch {}
    inflight.delete(requestId)
  }
}

/**
 * Helper to send debug logs to renderer
 */
export function sendDebugLog(level: 'info' | 'warning' | 'error', category: string, message: string, data?: any): void {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
  wc?.send('debug:log', { level, category, message, data })
}

/**
 * Intent detection helpers
 */
export function isEditIntentText(t: string): boolean {
  const s = (t || '').toLowerCase()
  const patterns: RegExp[] = [
    /\b(create|add|insert|write|overwrite|append)\b/,
    /\b(modify|update|change|replace|refactor|rename|move|delete)\b/,
    /\b(fix|patch|apply)\b/,
    /\b(import|export)\b/,
    /\.[a-z0-9]{1,6}\b/ // looks like a filename with extension
  ]
  return patterns.some(re => re.test(s))
}

export function isPlanIntentText(t: string): boolean {
  const s = (t || '').toLowerCase()
  const patterns: RegExp[] = [
    /\b(plan|planning|roadmap|strategy|approach|design|proposal|rfc)\b/,
    /\b(implementation plan|migration plan|rollout plan|outline steps|how should we|what's the plan)\b/,
    /\b(break\s?down|milestones|acceptance criteria|estimate|estimation)\b/,
  ]
  return patterns.some(re => re.test(s))
}

export function isTerminalIntentText(t: string): boolean {
  const s = (t || '').toLowerCase()
  const patterns: RegExp[] = [
    /\b(run|execute|open|start)\b.*\b(cmd|powershell|terminal|shell)\b/,
    /\b(dir|ls|pwd|cd|git|pnpm|npm|yarn|node|python|pip|go|cargo|make|gradle|mvn)\b/,
    /^\s*(dir|ls|pwd|git|pnpm|npm|yarn|node|python|pip|go|cargo|make|gradle|mvn)\b/,
  ]
  return patterns.some(re => re.test(s))
}

/**
 * Produce a slim copy of tools with minimal descriptions
 */
export function slimTools(tools: any[]): any[] {
  const strip = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(strip)
    const out: any = {}
    for (const k of Object.keys(obj)) {
      if (k === 'description' || k === 'examples' || k === 'example') continue
      out[k] = strip((obj as any)[k])
    }
    return out
  }
  return tools.map((t) => ({
    ...t,
    // keep a tiny description to satisfy some providers, but avoid long prose
    description: t.description && t.description.length > 80 ? t.description.slice(0, 80) : (t.description || ''),
    parameters: strip(t.parameters),
  }))
}

/**
 * Register core LLM IPC handlers
 */
export function registerLlmCoreHandlers(ipcMain: IpcMain): void {
  /**
   * Cancel LLM request (used by flows)
   */
  ipcMain.handle('llm:cancel', async (_event, args: { requestId: string }) => {
    const handle = inflight.get(args.requestId)
    try {
      handle?.cancel()
    } finally {
      inflight.delete(args.requestId)
    }
    
    try {
      const rel = rateReleaseByRequest.get(args.requestId)
      rel?.()
      rateReleaseByRequest.delete(args.requestId)
    } catch {}
    
    return { ok: true }
  })
}

/**
 * Export inflight map for use by other modules
 */
export function getInflight(): Map<string, StreamHandle> {
  return inflight
}

/**
 * Export rate release map for use by other modules
 */
export function getRateReleaseByRequest(): Map<string, () => void> {
  return rateReleaseByRequest
}

