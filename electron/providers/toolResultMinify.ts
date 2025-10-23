import type { SearchWorkspaceResult } from '../tools/workspace/searchWorkspace'

// Produce a compact, conversation-safe payload for heavy tool results.
// This prevents runaway memory usage by avoiding embedding large arrays/snippets
// in the provider conversation buffers. Keep only what the LLM needs to reason
// about next actions (handles, summaries, cursors), not the full data.
export function minifyToolResult(toolName: string, result: any): any {
  const name = String(toolName || '').toLowerCase()

  // Helper to access possibly wrapped { ok, data } payloads
  const unwrap = (x: any) => (x && typeof x === 'object' && 'data' in x ? x.data : x)

  try {
    if (name === 'workspace.search') {
      const payload = unwrap(result) as Partial<SearchWorkspaceResult & {
        bestHandle?: any; topHandles?: any[]; meta?: any; results?: any[]; summary?: string[]
      }>
      const count = Array.isArray(payload?.results) ? payload!.results!.length : 0
      return {
        ok: result?.ok ?? true,
        summary: payload?.summary || [],
        bestHandle: payload?.bestHandle,
        topHandles: payload?.topHandles || [],
        count,
        truncated: !!(payload as any)?.meta?.truncated,
      }
    }

    if (name === 'text.grep') {
      const payload = unwrap(result) as any
      const matches = Array.isArray(payload?.matches) ? payload.matches : payload?.data?.matches || []
      const summary = payload?.summary || payload?.data?.summary || {}
      const nextCursor = payload?.nextCursor || payload?.data?.nextCursor
      const topFiles = Array.from(new Set(matches.map((m: any) => m?.file))).filter(Boolean).slice(0, 5)
      return {
        ok: result?.ok ?? true,
        summary,
        topFiles,
        nextCursor: nextCursor ? 'present' : undefined,
      }
    }

    if (name === 'astgrep.search' || name === 'code.ast_grep' || name === 'astgrep') {
      const payload = unwrap(result) as any
      const count = Array.isArray(payload?.matches) ? payload.matches.length : Array.isArray(payload?.data?.matches) ? payload.data.matches.length : 0
      return { ok: result?.ok ?? true, count }
    }

    // Fallback: if it's a primitive or already small, return as-is. If it's large, return a preview.
    if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || result == null) {
      return result
    }

    let json = ''
    try { json = JSON.stringify(result) } catch { json = '[unserializable-result]' }
    if (json.length <= 4000) return result

    return {
      ok: true,
      note: 'large tool result omitted to save memory',
      preview: json.slice(0, 1000) + '...'
    }
  } catch {
    // Never throw from minifier; return minimal safe version
    return { ok: true, note: 'minify failed; result omitted' }
  }
}

