/**
 * Flow Execution Engine V2 - Main Entry Point
 *
 * Clean, function-based execution with explicit inputs/outputs
 */

import type { WebContents } from 'electron'
import { FlowScheduler } from './scheduler'
import { flowEvents, emitFlowEvent } from './events'
import type { FlowExecutionArgs } from './types'

import { broadcastWorkspaceNotification } from '../../backend/ws/broadcast'
import { UiPayloadCache } from '../../core/uiPayloadCache'

import { useMainStore } from '../../store'
import { sessionSaver } from '../../store/utils/session-persistence'

// Active flow schedulers

function getWorkspaceIdForSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null
  try {
    const st: any = useMainStore.getState()
    const map = st.sessionsByWorkspace || {}
    for (const [ws, list] of Object.entries(map as Record<string, any[]>)) {
      if (Array.isArray(list) && (list as any[]).some((s: any) => s?.id === sessionId)) return ws as string
    }
  } catch {}
  return null
}

const activeFlows = new Map<string, FlowScheduler>()

// Track persistence subscriptions per request to clean up on cancel/error
const persistSubs = new Map<string, () => void>()

// Set up session timeline persistence in main store for a running flow
function setupPersistenceForFlow(requestId: string, args: FlowExecutionArgs): () => void {
  const sessionId = (args as any).sessionId as string | undefined
  if (!sessionId) {
    return () => {}
  }
  console.log('[flows-v2] setupPersistenceForFlow: enabled', { requestId, sessionId })


  // Build fast node metadata lookup
  const nodeMeta = new Map<string, { label: string; kind: string }>()
  try {
    for (const n of (args.flowDef?.nodes || [])) {
      const label = (n as any)?.data?.label || (n as any)?.data?.labelBase || (n as any)?.data?.nodeType || 'Node'
      const kind = (n as any)?.data?.nodeType || (n as any)?.type || 'unknown'
      nodeMeta.set((n as any).id, { label, kind })
    }
  } catch {}

  // Helper: broadcast current session usage snapshot to all renderers
  function broadcastSessionUsage() {
    try {
      const st: any = useMainStore.getState()
      const ws = getWorkspaceIdForSessionId(sessionId) || st.workspaceRoot || null
      if (!ws) return
      const list = (((st.sessionsByWorkspace || {})[ws]) || [])
      const sess = list.find((s: any) => s.id === sessionId)
      if (!sess) return
      const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
      const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
      const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []
      if (ws) broadcastWorkspaceNotification(ws, 'session.usage.changed', { tokenUsage, costs, requestsLog })
    } catch (e) {
      try { console.warn('[flows-v2] broadcastSessionUsage failed', e) } catch {}
    }
  }


  // Local buffers per node for debounced flushes
  const textBuffers = new Map<string, string>()
  const badgeQueues = new Map<string, any[]>()
  const flushTimeouts = new Map<string, NodeJS.Timeout>()
  const openBoxIds = new Map<string, string>()
  const reasoningBuffers = new Map<string, string>()


  // Track last tool args per tool for header reconstruction on end/error
  const lastToolArgs = new Map<string, any>()

  const formatToolName = (name: string): string => {
    try {
      const parts = String(name || 'Tool').split('.')
      return parts.map((p) => (p.toLowerCase() === 'fs' ? 'FS' : (p.charAt(0).toUpperCase() + p.slice(1)))).join('.')
    } catch {
      return String(name || 'Tool')
    }
  }

  const normalizeTool = (name: string): { normalized: string; key: string } => {
    const normalized = String(name || '').replace(/\./g, '_')
    const key = normalized.replace(/[_.-]/g, '').toLowerCase()
    return { normalized, key }
  }

  const tryParseHandle = (h: any): any | undefined => {
    if (!h) return undefined
    if (typeof h === 'object') return h
    if (typeof h === 'string') {
      try { return JSON.parse(h) } catch {}
    }
    return undefined
  }

  const deriveFsReadLinesMeta = (args: any): any => {
    try {
      const a = args || {}
      let filePath: string | undefined = a.path
      let lineRange: string | undefined
      const h = tryParseHandle(a.handle)
      const s = Number(a.start ?? a.startLine ?? a.start_line)
      const e = Number(a.end ?? a.endLine ?? a.end_line)
      if (!filePath && h && typeof h.path === 'string') filePath = h.path
      if (!isNaN(s) && !isNaN(e) && s > 0 && e >= s) lineRange = `L${s}-${e}`
      else if (!isNaN(s) && s > 0) lineRange = `L${s}`
      return { ...(filePath ? { filePath } : {}), ...(lineRange ? { lineRange } : {}), fullParams: a }
    } catch {
      return undefined
    }
  }

  const deriveWorkspaceSearchHeader = (args: any): string | undefined => {
    try {
      const a = args || {}
      const terms: string[] = Array.isArray(a.queries) && a.queries.length
        ? a.queries.map((t: any) => String(t)).filter(Boolean)
        : (typeof a.query === 'string' ? String(a.query).split('|').map((t) => t.trim()).filter(Boolean) : [])
      if (!terms.length && typeof a.query === 'string') return a.query.trim()
      if (!terms.length) return undefined
      const head = terms.slice(0, 3).join(' | ')
      return head + (terms.length > 3 ? ' …' : '')
    } catch {
      return undefined
    }
  }


  function flush(key: string, immediate = false) {
    const parts = String(key).split('::')
    const nodeId = parts[0]
    const executionId = parts[1]
    const reasoning = (reasoningBuffers.get(key) || '')


    const txt = (textBuffers.get(key) || '')
    const badges = badgeQueues.get(key) || []
    if (!txt.trim() && !reasoning && badges.length === 0) {
      // Nothing meaningful to flush right now (e.g., only whitespace so far).
      // Clear any pending debounce timer so the next incoming chunk can schedule a new flush.
      const pending = flushTimeouts.get(key)
      if (pending) { try { clearTimeout(pending) } catch {} flushTimeouts.delete(key) }
      return
    }

    const meta = nodeMeta.get(nodeId) || { label: 'Node', kind: 'unknown' }

    let didCreate = false
    useMainStore.setState((s: any) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const list: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])
      const idx = list.findIndex((sess: any) => sess.id === sessionId)
      if (idx === -1) return {}
      const sess = list[idx]
      const items = Array.isArray(sess.items) ? [...sess.items] : []

      let boxId = openBoxIds.get(key)
      if (!boxId) {
        boxId = `box-${nodeId}-${executionId || Date.now()}`
        openBoxIds.set(key, boxId)
        const newBox: any = {
          type: 'node-execution',
          id: boxId,
          nodeId,
          executionId,
          nodeLabel: meta.label,
          nodeKind: meta.kind,
          timestamp: Date.now(),
          content: [],
        }
        if (reasoning) newBox.content.push({ type: 'reasoning', text: reasoning })

        if (txt.trim()) newBox.content.push({ type: 'text', text: txt })
        for (const b of badges) newBox.content.push({ type: 'badge', badge: b })
        items.push(newBox)

        didCreate = true
      } else {
        const boxIdx = items.findIndex((it: any) => it.type === 'node-execution' && it.id === boxId)
        if (boxIdx >= 0) {
          const box: any = { ...items[boxIdx] }
          if (reasoning) box.content = [...box.content, { type: 'reasoning', text: reasoning }]
          if (txt.trim()) box.content = [...box.content, { type: 'text', text: txt }]

          for (const b of badges) box.content = [...box.content, { type: 'badge', badge: b }]
          items[boxIdx] = box
        } else {
          // If box disappeared (e.g., session switched), create a new one
          openBoxIds.delete(key)
          const newBox: any = {
            type: 'node-execution',
            id: `box-${nodeId}-${executionId || Date.now()}`,
            nodeId,
            executionId,
            nodeLabel: meta.label,
            nodeKind: meta.kind,
            timestamp: Date.now(),
            content: [],
          }
          if (reasoning) newBox.content.push({ type: 'reasoning', text: reasoning })
          if (txt.trim()) newBox.content.push({ type: 'text', text: txt })
          for (const b of badges) newBox.content.push({ type: 'badge', badge: b })
          items.push(newBox)
          didCreate = true
        }
      }

      const updated = { ...sess, items, updatedAt: Date.now(), lastActivityAt: Date.now() }
      const sessions = list.slice(); sessions[idx] = updated
      return { sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions } }
    })
    try { console.log('[flows-v2] broadcast delta', { op: didCreate ? 'upsertBox' : 'appendToBox', sessionId, nodeId, executionId, textLen: txt.length, reasonLen: reasoning.length, badgesLen: badges.length }) } catch {}

    // Broadcast delta to renderers
    try {
      const ws = getWorkspaceIdForSessionId(sessionId) || ((useMainStore.getState() as any).workspaceRoot || null)

      if (didCreate) {
        if (ws) broadcastWorkspaceNotification(ws, 'session.timeline.delta', {
          sessionId,
          op: 'upsertBox',
          nodeId,
          executionId,
          append: { text: txt, reasoning, badges }
        })
      } else if (txt.trim() || reasoning || (badges && badges.length)) {
        if (ws) broadcastWorkspaceNotification(ws, 'session.timeline.delta', {
          sessionId,
          op: 'appendToBox',
          nodeId,
          executionId,
          append: { text: txt, reasoning, badges }
        })
      }
    // Also broadcast a full snapshot to guarantee renderer hydration
    try {
      const st: any = useMainStore.getState()
      const ws = st.workspaceRoot || null
      if (ws) {
        const list = (((st.sessionsByWorkspace || {})[ws]) || [])
        const sess = list.find((s: any) => s.id === sessionId)
        const itemsSnap = Array.isArray(sess?.items) ? sess.items : []
        broadcastWorkspaceNotification(ws, 'session.timeline.snapshot', { sessionId, items: itemsSnap })
      }
    } catch {}
    } catch {}

    // Clear local buffers and timeouts
    textBuffers.delete(key)
    reasoningBuffers.delete(key)

    badgeQueues.delete(key)
    const t = flushTimeouts.get(key)
    if (t) { clearTimeout(t); flushTimeouts.delete(key) }

    // Debounced disk save for this specific session
    try {
      const stAny: any = useMainStore.getState()
      const ws = stAny.workspaceRoot || null
      if (ws) {
        const list = (((stAny.sessionsByWorkspace || {})[ws]) || [])
        const sess = list.find((ss: any) => ss.id === sessionId)
        if (sess) sessionSaver.save(sess, immediate)
      }
    } catch {}
  }

  function debounceFlush(key: string) {
    if (flushTimeouts.has(key)) return
    const t = setTimeout(() => flush(key, false), 100)
    flushTimeouts.set(key, t)
  }

  const unsubscribe = flowEvents.onFlowEvent(requestId, (ev: any) => {
    const t = ev?.type
    const nid = ev?.nodeId as string | undefined
    const execId = (ev?.executionId as string | undefined) || undefined
    const key = nid ? `${nid}${execId ? `::${execId}` : ''}` : undefined

    if (t === 'chunk' && key && nid) {
      const prev = textBuffers.get(key) || ''
      const next = prev + (ev.text ?? '')
      textBuffers.set(key, next)
      debounceFlush(key)
      return
    }

    if (t === 'reasoning' && key && nid) {
      const prev = reasoningBuffers.get(key) || ''
      const next = prev + (ev.text ?? '')
      reasoningBuffers.set(key, next)
      debounceFlush(key)
      return
    }


    if (t === 'toolStart' && key && nid) {
      const arr = badgeQueues.get(key) || []
      const label = formatToolName(ev.toolName || 'Tool')
      const { normalized, key: tkey } = normalizeTool(ev.toolName || '')
      if (ev.toolArgs) {
        try { lastToolArgs.set(tkey || normalized, ev.toolArgs) } catch {}
      }
      let metadata: any = undefined
      // fs.read_lines: show file path + line range in header
      if (normalized === 'fs_read_lines' || tkey === 'fsreadlines') {
        metadata = deriveFsReadLinesMeta(ev.toolArgs)
      }
      // workspace.search: show query header
      if (tkey === 'workspacesearch') {
        const q = deriveWorkspaceSearchHeader(ev.toolArgs)
        if (q) metadata = { ...(metadata || {}), query: q, fullParams: ev.toolArgs }
      }
      // fs.write_file: show file path in header
      if (normalized === 'fs_write_file' || tkey === 'fswritefile') {
        const p = ev.toolArgs?.path
        if (p) metadata = { ...(metadata || {}), filePath: p }
      }
      // fs.delete_file: show file path in header
      if (normalized === 'fs_delete_file' || tkey === 'fsdeletefile') {
        const p = ev.toolArgs?.path
        if (p) metadata = { ...(metadata || {}), filePath: p }
      }

      arr.push({ id: ev.callId || `badge-${Date.now()}`, type: 'tool', label, status: 'running', timestamp: Date.now(), ...(metadata ? { metadata } : {}) })
      badgeQueues.set(key, arr)
      flush(key, true)
      return
    }

    if (t === 'toolEnd' && nid) {
      // Ensure pending text is flushed
      if (key) flush(key)

      // Build rich badge updates (title already set on start); add expansion + metadata
      const { normalized, key: tkey } = normalizeTool(ev.toolName || '')
      const argsUsed = (ev.toolArgs || lastToolArgs.get(tkey || normalized) || {})
      const result = ev.result || {}

      let updates: any = { status: 'success', color: 'green' }

      // workspace.search → expandable list of results
      if (tkey === 'workspacesearch') {
        const previewKey = (result as any)?.previewKey
        const count = Number((result as any)?.previewCount ?? (Array.isArray((result as any)?.data?.results) ? (result as any).data.results.length : 0) ?? 0)
        updates = {
          ...updates,
          expandable: true,
          defaultExpanded: false,
          contentType: 'workspace-search',
          metadata: {
            resultCount: count,
            ...(deriveWorkspaceSearchHeader(argsUsed) ? { query: deriveWorkspaceSearchHeader(argsUsed) } : {})
          },
          // Use provider's previewKey for UI fetch (falls back to callId if missing)
          interactive: { type: 'workspace-search', data: { key: (previewKey || ev.callId), count } }
        }
      }

      // fs.read_lines → show file + lines, expandable to full content
      if (normalized === 'fs_read_lines' || tkey === 'fsreadlines') {
        const meta = deriveFsReadLinesMeta((result as any)?.usedParams || argsUsed)
        updates = {
          ...updates,
          expandable: true,
          defaultExpanded: false,
          contentType: 'read-lines',
          ...(meta ? { metadata: meta } : {}),
          interactive: { type: 'read-lines', data: { key: ev.callId } }
        }
      }

      // fs.read_file → expandable to raw content
      if (normalized === 'fs_read_file' || tkey === 'fsreadfile') {
        const used = (result as any)?.usedParams || argsUsed
        const filePath = used?.path || used?.file_path
        updates = {
          ...updates,
          expandable: true,
          defaultExpanded: false,
          contentType: 'read-lines',
          ...(filePath ? { metadata: { filePath } } : {}),
          interactive: { type: 'read-lines', data: { key: ev.callId } }
        }
      }

      // fs.write_file / fsWriteFile → single-file diff preview and filename in header
      if (normalized === 'fs_write_file' || tkey === 'fswritefile') {
        const previews = Array.isArray((result as any)?.fileEditsPreview) ? (result as any).fileEditsPreview : []
        const filePath = (result as any)?.path || (argsUsed?.path)
        if (previews.length) {
          // Put previews keyed by callId so edits.preview works
          try { UiPayloadCache.put(String(ev.callId), previews) } catch {}
          // Compute line deltas (robust, line-based)
          const compute = (before?: string, after?: string) => {
            const a = String(before ?? '').split(/\r?\n/)
            const b = String(after ?? '').split(/\r?\n/)
            const n = a.length, m = b.length
            if (n === 0 && m === 0) return { added: 0, removed: 0 }
            const LIMIT = 1_000_000
            if (n * m > LIMIT) {
              let i = 0, j = 0
              while (i < n && j < m && a[i] === b[j]) { i++; j++ }
              return { added: (m - j), removed: (n - i) }
            }
            let prev = new Uint32Array(m + 1), curr = new Uint32Array(m + 1)
            for (let i = 1; i <= n; i++) {
              const ai = a[i - 1]
              for (let j = 1; j <= m; j++) {
                curr[j] = ai === b[j - 1] ? (prev[j - 1] + 1) : (prev[j] > curr[j - 1] ? prev[j] : curr[j - 1])
              }
              const tmp = prev; prev = curr; curr = tmp
              curr.fill(0)
            }
            const lcs = prev[m]
            return { added: m - lcs, removed: n - lcs }
          }
          let addedLines = 0, removedLines = 0
          for (const f of previews) {
            const { added, removed } = compute(f.before, f.after)
            addedLines += added; removedLines += removed
          }
          updates = {
            ...updates,
            expandable: true,
            defaultExpanded: false,
            contentType: 'diff',
            addedLines,
            removedLines,
            filesChanged: previews.length,
            metadata: { fileCount: previews.length, ...(previews.length === 1 ? { filePath: previews[0]?.path || filePath } : (filePath ? { filePath } : {})) },
            interactive: { type: 'diff', data: { key: ev.callId, count: previews.length } }
          }
        } else if (filePath) {
          updates = { ...updates, metadata: { filePath } }
        }
      }

      // fs.delete_file → include filename in header (no expansion)
      if (normalized === 'fs_delete_file' || tkey === 'fsdeletefile') {
        const used = (result as any)?.usedParams || argsUsed
        const filePath = (result as any)?.path || used?.path
        if (filePath) {
          updates = { ...updates, metadata: { filePath } }
        }
      }

      // edits.apply / applyPatch / code.applyEditsTargeted → diff preview
      if (tkey === 'applyedits' || tkey === 'applypatch' || tkey === 'codeapplyeditstargeted') {
        const previewKey = (result as any)?.previewKey
        let previews: any[] = []
        if (previewKey) {
          try {
            const p = UiPayloadCache.peek(previewKey)
            if (Array.isArray(p)) previews = p
          } catch {}
        }
        const filesChanged = Number((result as any)?.previewCount || (Array.isArray(previews) ? previews.length : 0) || 0)

        // Compute line deltas and single-file header if we have previews
        let addedLines = 0, removedLines = 0
        let singleFilePath: string | undefined = undefined
        if (previews.length) {
          if (previews.length === 1 && typeof previews[0]?.path === 'string') singleFilePath = String(previews[0].path)
          const compute = (before?: string, after?: string) => {
            const a = String(before ?? '').split(/\r?\n/)
            const b = String(after ?? '').split(/\r?\n/)
            const n = a.length, m = b.length
            if (n === 0 && m === 0) return { added: 0, removed: 0 }
            const LIMIT = 1_000_000
            if (n * m > LIMIT) {
              let i = 0, j = 0
              while (i < n && j < m && a[i] === b[j]) { i++; j++ }
              return { added: (m - j), removed: (n - i) }
            }
            let prev = new Uint32Array(m + 1), curr = new Uint32Array(m + 1)
            for (let i = 1; i <= n; i++) {
              const ai = a[i - 1]
              for (let j = 1; j <= m; j++) {
                curr[j] = ai === b[j - 1] ? (prev[j - 1] + 1) : (prev[j] > curr[j - 1] ? prev[j] : curr[j - 1])
              }
              const tmp = prev; prev = curr; curr = tmp
              curr.fill(0)
            }
            const lcs = prev[m]; return { added: m - lcs, removed: n - lcs }
          }
          for (const f of previews) {
            const { added, removed } = compute(f.before, f.after)
            addedLines += added; removedLines += removed
          }
        }

        if (filesChanged || previewKey) {
          updates = {
            ...updates,
            expandable: true,
            defaultExpanded: false,
            contentType: 'diff',
            ...(addedLines || removedLines ? { addedLines, removedLines } : {}),
            metadata: { fileCount: filesChanged || undefined, ...(singleFilePath ? { filePath: singleFilePath } : {}) },
            // Use provider's previewKey for UI fetch (falls back to callId if missing)
            interactive: { type: 'diff', data: { key: (previewKey || ev.callId), count: filesChanged } }
          }
        }
      }

      // Apply updates to store
      useMainStore.setState((s: any) => {
        const ws = (s as any).workspaceRoot || null
        if (!ws) return {}
        const list: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])
        const idx = list.findIndex((sess: any) => sess.id === sessionId)
        if (idx === -1) return {}
        const sess = list[idx]
        const items = [...(sess.items || [])]
        let boxIndex = items.slice().reverse().findIndex((it: any) => it.type === 'node-execution' && it.nodeId === nid && (!execId || it.executionId === execId))
        if (boxIndex !== -1) {
          boxIndex = items.length - 1 - boxIndex
          const box: any = { ...items[boxIndex] }
          const rel = box.content.slice().reverse().findIndex((c: any) => c.type === 'badge' && c.badge?.id === ev.callId)
          if (rel !== -1) {
            const rev = box.content.length - 1 - rel
            const cur = box.content[rev]
            box.content = box.content.slice()
            box.content[rev] = { type: 'badge', badge: { ...(cur as any).badge, ...updates } }

            items[boxIndex] = box
            const updated = { ...sess, items, updatedAt: Date.now(), lastActivityAt: Date.now() }
            const sessions = list.slice(); sessions[idx] = updated
            return { sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions } }
          }
        }
        return {}
      })

      // Persist & notify renderers
      try {
        const stAny: any = useMainStore.getState()
        const ws = getWorkspaceIdForSessionId(sessionId) || stAny.workspaceRoot || null
        if (ws) {
          const list = (((stAny.sessionsByWorkspace || {})[ws]) || [])
          const sess = list.find((ss: any) => ss.id === sessionId)
          if (sess) sessionSaver.save(sess)
        }
      } catch {}
      try {
        const ws = getWorkspaceIdForSessionId(sessionId) || ((useMainStore.getState() as any).workspaceRoot || null)
        if (ws) broadcastWorkspaceNotification(ws, 'session.timeline.delta', {
          sessionId,
          op: 'updateBadge',
          nodeId: nid,
          executionId: execId,
          callId: ev.callId,
          updates
        })
        // Also broadcast a full snapshot to guarantee renderer hydration
        try {
          const st: any = useMainStore.getState()
          const ws = st.workspaceRoot || null
          if (ws) {
            const list = (((st.sessionsByWorkspace || {})[ws]) || [])
            const sess = list.find((s: any) => s.id === sessionId)
            const itemsSnap = Array.isArray(sess?.items) ? sess.items : []
            broadcastWorkspaceNotification(ws, 'session.timeline.snapshot', { sessionId, items: itemsSnap })
          }
        } catch {}
      } catch {}
      return
    }

    if (t === 'toolError' && key && nid) {
      const arr = badgeQueues.get(key) || []
      arr.push({ id: ev.callId || `badge-${Date.now()}`, type: 'error', label: ev.toolName, status: 'error', error: ev.error })
      badgeQueues.set(key, arr)
      flush(key, true)
      return
    }

    if (t === 'error') {
      const k = key || `${nid || 'system'}`
      const arr = badgeQueues.get(k) || []
      arr.push({ id: `err-${Date.now()}`, type: 'error', label: 'Error', status: 'error', error: ev.error })
      badgeQueues.set(k, arr)
      flush(k, true)
      return
    }
    if (t === 'usageBreakdown' && key && nid) {
      try {
        const br = (ev as any)?.breakdown
        const usageKey = `usage:${requestId}:${nid}:${execId || '0'}`
        if (br) UiPayloadCache.put(usageKey, br)
        const arr = badgeQueues.get(key) || []
        const meta = {
          inputTokens: br?.totals?.inputTokens,
          outputTokens: br?.totals?.outputTokens,
          totalTokens: br?.totals?.totalTokens,
          estimated: !!br?.estimated
        }
        arr.push({
          id: `usage-${Date.now()}`,
          type: 'tool',
          label: 'Usage',
          icon: '\ud83d\udcca',
          color: 'grape',
          variant: 'light',
          status: 'success',
          timestamp: Date.now(),
          expandable: true,
          defaultExpanded: false,
          contentType: 'usage-breakdown',
          interactive: { type: 'usage-breakdown', data: { key: usageKey } },
          metadata: meta
        })
        badgeQueues.set(key, arr)
        flush(key, true)
      } catch {}
      return
    }

    if (t === 'tokenUsage') {
      try {
        const { provider, model, usage } = ev
        useMainStore.setState((s: any) => {
          const ws = (s as any).workspaceRoot || null
          if (!ws) return {}
          const list: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])
          const idx = list.findIndex((sess: any) => sess.id === sessionId)
          if (idx === -1) return {}
          const sess = list[idx]
          const items = [...(sess.items || [])]
          let boxIndex = items.slice().reverse().findIndex((it: any) => it.type === 'node-execution' && it.nodeId === (ev.nodeId || '') && (!execId || it.executionId === execId))
          if (boxIndex !== -1) {
            boxIndex = items.length - 1 - boxIndex
            const box: any = { ...items[boxIndex], provider: provider || items[boxIndex].provider, model: model || items[boxIndex].model, cost: usage || items[boxIndex].cost }
            items[boxIndex] = box
            const updated = { ...sess, items, updatedAt: Date.now(), lastActivityAt: Date.now() }
            const sessions = list.slice(); sessions[idx] = updated

            return { sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions } }
          }
          return {}
        })
      } catch {}
      // Record usage into session totals (for Tokens & Costs panel)
      try {
        const st: any = useMainStore.getState()
        if (typeof st.recordTokenUsage === 'function' && ev.nodeId && execId) {
          st.recordTokenUsage({ sessionId, requestId, nodeId: ev.nodeId, executionId: execId, provider: ev.provider, model: ev.model, usage: ev.usage })
        }
      } catch {}
      try {
        const ws = getWorkspaceIdForSessionId(sessionId) || ((useMainStore.getState() as any).workspaceRoot || null)
        if (ws) broadcastWorkspaceNotification(ws, 'session.timeline.delta', {
          sessionId,
          op: 'updateBoxMeta',
          nodeId: ev.nodeId,
          executionId: execId,
          meta: { provider: ev.provider, model: ev.model, cost: ev.usage }
        })
        // Also broadcast a full snapshot to guarantee renderer hydration
        try {
          const st: any = useMainStore.getState()
          const ws = st.workspaceRoot || null
          if (ws) {
            const list = (((st.sessionsByWorkspace || {})[ws]) || [])
            const sess = list.find((s: any) => s.id === sessionId)
            const itemsSnap = Array.isArray(sess?.items) ? sess.items : []
            broadcastWorkspaceNotification(ws, 'session.timeline.snapshot', { sessionId, items: itemsSnap })
          }
        } catch {}
      } catch {}
      return
    }


    if (t === 'nodeEnd' && key && nid) {
      flush(key, true)
      openBoxIds.delete(key)
      // Finalize per-node usage into session totals
      try {
        const st: any = useMainStore.getState()
        if (typeof st.finalizeNodeUsage === 'function' && execId) {
          st.finalizeNodeUsage({ sessionId, requestId, nodeId: nid, executionId: execId })
        }
      } catch {}
      // Proactively notify usage snapshot so Tokens & Costs panel reacts immediately
      try { broadcastSessionUsage() } catch {}
      return
    }

    if (t === 'done') {
      // Flush any remaining content
      for (const k of Array.from(textBuffers.keys())) flush(k, true)
      for (const k of Array.from(badgeQueues.keys())) flush(k, true)
      // Finalize any remaining usage for this request
      try {
        const st: any = useMainStore.getState()
        if (typeof st.finalizeRequestUsage === 'function') {
          st.finalizeRequestUsage({ sessionId, requestId })
        }
      } catch {}
      // Proactively notify usage snapshot so Tokens & Costs panel reacts immediately
      try { broadcastSessionUsage() } catch {}
      return
    }
  })

  return () => {
    try {
      for (const t of flushTimeouts.values()) clearTimeout(t)
    } catch {}
    try { unsubscribe() } catch {}
  }
}



/**
 * Execute a flow
 */
export async function executeFlow(
  wc: WebContents | undefined,
  args: FlowExecutionArgs
): Promise<{ ok: boolean; error?: string }> {
  console.log('[executeFlow] begin', { requestId: args.requestId, sessionId: (args as any)?.sessionId, nodes: (args as any)?.flowDef?.nodes?.length, edges: (args as any)?.flowDef?.edges?.length })

  const { requestId, flowDef } = args

  // Persist timeline for this flow to the main store
  const persistUnsubscribe = setupPersistenceForFlow(requestId, args)
  persistSubs.set(requestId, persistUnsubscribe)


  emitFlowEvent(requestId, { type: 'io', nodeId: 'system', data: `[Flow V2] Starting execution with ${flowDef.nodes.length} nodes, ${flowDef.edges.length} edges` })

  try {
    // Create scheduler
    const scheduler = new FlowScheduler(wc, requestId, flowDef, args)
    activeFlows.set(requestId, scheduler)

    // Execute - the flow runs until it hits a userInput node (which awaits indefinitely)
    // The promise will only resolve if there's an error or the flow is explicitly cancelled
    // Normal flows should NEVER complete - they wait at userInput nodes
    const result = await scheduler.execute()

    // Keep the flow active - don't emit "done" or clean up
    // The flow can still be resumed with user input
    return result
  } catch (e: any) {
    // Only clean up on actual errors
    activeFlows.delete(requestId)
    try { persistSubs.get(requestId)?.() } catch {}
    persistSubs.delete(requestId)
    try { persistUnsubscribe() } catch {}
    // Do not cleanup global flow event forwarders; keep listening for this requestId
    const error = e?.message || String(e)
    console.error('[executeFlow] Error:', error)
    console.error('[executeFlow] Stack:', e?.stack)
    emitFlowEvent(requestId, { type: 'error', error })
    emitFlowEvent(requestId, { type: 'done' })
    return { ok: false, error }
  }
}

/**
 * Resume a paused flow with user input
 * Provider/model switching is handled by refreshMainContextFromStore() before each node execution
 */
export async function resumeFlow(
  _wc: WebContents | undefined,
  requestId: string,
  userInput: string
): Promise<{ ok: boolean; error?: string }> {
  console.log('[resumeFlow] Called with:', { requestId, userInputLength: userInput.length })

  const scheduler = activeFlows.get(requestId)

  if (!scheduler) {
    console.error('[resumeFlow] Scheduler not found for requestId:', requestId)
    return { ok: false, error: 'Flow not found or not active' }
  }

  try {
    // Resolve the promise that the userInput node is awaiting
    // The scheduler knows which node is waiting - just resolve any waiting input
    // Provider/model will be refreshed from session context before next node execution
    console.log('[resumeFlow] Calling scheduler.resolveAnyWaitingUserInput')
    scheduler.resolveAnyWaitingUserInput(userInput)

    return { ok: true }
  } catch (e: any) {
    const error = e?.message || String(e)
    console.error('[resumeFlow] Error:', error)
    emitFlowEvent(requestId, { type: 'error', error })
    return { ok: false, error }
  }
}

/**
 * Get an active flow scheduler (for backwards compatibility)
 * @deprecated Nodes should use store actions instead of accessing the scheduler directly
 */
export function getActiveFlow(requestId: string) {
  return activeFlows.get(requestId)
}

/**
 * Cancel a flow
 */
export async function cancelFlow(requestId: string): Promise<{ ok: boolean; error?: string }> {
  const scheduler = activeFlows.get(requestId)
  if (scheduler) {
    try {
      // Cooperatively cancel the running flow
      scheduler.cancel()
    } catch (e) {
      // Best-effort cancel
      console.warn('[cancelFlow] Error cancelling scheduler:', e)
    }

    // Remove from active set first to prevent new work scheduling
    activeFlows.delete(requestId)

    // Emit "done" BEFORE tearing down listeners so both the WS forwarder and
    // persistence subscriber can flush and notify renderers
    try { emitFlowEvent(requestId, { type: 'done' }) } catch {}

    // Allow the synchronous onFlowEvent handlers to run before cleanup
    // (EventEmitter dispatch is synchronous)
    try { persistSubs.get(requestId)?.() } catch {}
    persistSubs.delete(requestId)
    // Keep flowEvents listeners attached; renderer should always be listening

    return { ok: true }
  }
  return { ok: false, error: 'Flow not found' }
}





/**
 * Get snapshot/status for a specific flow (or null if not found)
 */
export function getFlowSnapshot(requestId: string): { requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null } | null {
  const scheduler = activeFlows.get(requestId)
  if (!scheduler) return null
  try {
    return scheduler.getSnapshot()
  } catch (e) {
    return null
  }
}

/**
 * Get snapshots for all active flows
 */
export function getAllFlowSnapshots(): Array<{ requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null }> {
  const out: Array<{ requestId: string; status: 'running' | 'waitingForInput' | 'stopped'; activeNodeIds: string[]; pausedNodeId: string | null }> = []
  for (const scheduler of activeFlows.values()) {
    try { out.push(scheduler.getSnapshot()) } catch {}
  }
  return out
}

/**
 * List active flow request IDs
 */
export function listActiveFlows(): string[] {
  return Array.from(activeFlows.keys())
}
