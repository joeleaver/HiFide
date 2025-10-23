/* Lightweight render/re-render tracing utilities (renderer only)
 * No external deps; safe in dev and prod (logs gated by NODE_ENV)
 */

import { useEffect, useRef } from 'react'

const isDev = import.meta?.env?.MODE !== 'production'

function idsSig(arr: any[]) {
  if (!Array.isArray(arr)) return '[]'
  // Stable signature by ids only
  try { return `${arr.length}:${arr.map((x) => x && x.id).join('|')}` } catch { return `${arr.length}` }
}

const customComparators: Record<string, (a: any, b: any) => boolean> = {
  feNodes: (a, b) => idsSig(a) === idsSig(b),
  feEdges: (a, b) => idsSig(a) === idsSig(b),
  sessions: (a, b) => idsSig(a) === idsSig(b),
  feFlowState: (a, b) => {
    try {
      const ak = Object.keys(a || {})
      const bk = Object.keys(b || {})
      if (ak.length !== bk.length) return false
      for (const id of ak) {
        const va: any = (a as any)[id] || {}
        const vb: any = (b as any)[id] || {}
        if (va.status !== vb.status) return false
        if (va.cacheHit !== vb.cacheHit) return false
        if (va.durationMs !== vb.durationMs) return false
        if (va.costUSD !== vb.costUSD) return false
        const as = va.style || {}
        const bs = vb.style || {}
        if (as.border !== bs.border || as.boxShadow !== bs.boxShadow) return false
      }
      return true
    } catch { return false }
  },
  feMainFlowContext: (a, b) => {
    try {
      const pa = a?.provider, pb = b?.provider
      const ma = a?.model, mb = b?.model
      const sia = (a?.systemInstructions || ''), sib = (b?.systemInstructions || '')
      const ha = Array.isArray(a?.messageHistory) ? a.messageHistory.length : 0
      const hb = Array.isArray(b?.messageHistory) ? b.messageHistory.length : 0
      return pa === pb && ma === mb && sia === sib && ha === hb
    } catch { return false }
  },
  modelsByProvider: (a, b) => {
    try {
      const provs = ['openai','anthropic','gemini']
      for (const p of provs) {
        const aa: any[] = (a?.[p] || [])
        const bb: any[] = (b?.[p] || [])
        if (aa.length !== bb.length) return false
        for (let i=0;i<aa.length;i++) if (aa[i] !== bb[i]) return false
      }
      return true
    } catch { return false }
  },
  windowState: (a, b) => {
    if (!a || !b) return a === b
    try {
      // Compare only primitive fields shallowly
      const keys = Object.keys(a)
      for (const k of keys) {
        const va = a[k], vb = b[k]
        if (typeof va === 'object' || typeof vb === 'object') continue
        if (va !== vb) return false
      }
      return true
    } catch { return false }
  },
}

function shallowDiff(prev: Record<string, any>, next: Record<string, any>) {
  const changed: Array<{ key: string; prev: any; next: any }> = []
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
  keys.forEach((k) => {
    const a = (prev as any)?.[k]
    const b = (next as any)?.[k]
    if (a === b) return
    const cmp = customComparators[k]
    if (cmp) {
      if (!cmp(a, b)) changed.push({ key: k, prev: a, next: b })
    } else {
      changed.push({ key: k, prev: a, next: b })
    }
  })
  return changed
}

export function useRerenderTrace(name: string, watched: Record<string, any>) {
  const prevRef = useRef<Record<string, any> | null>(null)
  const tsRef = useRef<number>(performance.now())

  useEffect(() => {
    if (!isDev) return
    const now = performance.now()
    const prev = prevRef.current
    if (prev) {
      const diffs = shallowDiff(prev, watched)
      if (diffs.length > 0) {
        const since = (now - (tsRef.current || now)).toFixed(1)
        // Log concise change list; expand in console to inspect values
        // eslint-disable-next-line no-console
        console.debug(`🔁 ${name} re-render (+${since}ms) changed:`, diffs.map(d => d.key))
      }
    } else {
      // First mount
      // eslint-disable-next-line no-console
      console.debug(`🔁 ${name} mount`)
    }
    prevRef.current = watched
    tsRef.current = now
  })
}

// Subscribe helper: log top-level store key changes (shallow)
export function logStoreDiff(_label: string, prev: any, next: any) {
  if (!isDev) return
  const prevObj = (prev && typeof prev === 'object') ? prev : {}
  const nextObj = (next && typeof next === 'object') ? next : {}
  const diffs = shallowDiff(prevObj, nextObj)
  if (diffs.length) {
    // eslint-disable-next-line no-console
    //console.debug(`🗂️ ${label} changed keys:`, diffs.map(d => d.key))
  }
}

