import type { AgentTool } from '../../providers/provider'
import { listItems, type KbHit } from '../../store/utils/knowledgeBase'
import { getKbIndexer } from '../../core/state'
import { ServiceRegistry } from '../../services/base/ServiceRegistry.js'

export const knowledgeBaseSearchTool: AgentTool = {
  name: 'knowledgeBaseSearch',
  description: 'Search the project Knowledge Base for documentation. If information is missing, create or update entries with knowledgeBaseStore instead of writing files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text matched against title, tags, markdown body, and related file paths. Optional.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter results to entries containing ALL these tags (case-insensitive).' },
      limit: { type: 'number', description: 'Maximum number of results to return (default 50).' }
    },
  },
  run: async (input: any, meta?: any) => {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const baseDir = meta?.workspaceId || workspaceService?.getWorkspaceRoot() || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    const query = typeof input?.query === 'string' ? input.query : ''
    const tags: string[] = Array.isArray(input?.tags) ? (input.tags as any[]).map((t) => String(t)) : []
    const limit = typeof input?.limit === 'number' ? input.limit : 50

    const qLower = (query || '').toLowerCase().trim()
    const idx = await getKbIndexer()

    // Ensure index is ready, and self-heal if empty results (helps tests without watchers)
    const st1 = idx.status()
    if (!st1.ready || (st1.chunks ?? 0) === 0) {
      try { await idx.rebuild(() => {}) } catch {}
    }

    const items = await listItems(baseDir)
    const byRel: Record<string, KbHit> = {}
    for (const it of items) byRel[it.relPath.replace(/^\\?/, '')] = it as KbHit

    const k = Math.max(100, limit * 3)
    let sem = await idx.search(qLower || '', k)
    if ((sem.chunks?.length || 0) === 0) {
      // Rebuild once and retry, to catch very recent KB writes in CI
      try { await idx.rebuild(() => {}) } catch {}
      sem = await idx.search(qLower || '', k)
    }

    // Group top chunks by document path, keep the earliest-ranked chunk per doc
    const seen = new Set<string>()
    const groups: { path: string; baseScore: number; chunkText: string }[] = []
    sem.chunks.forEach((c, i) => {
      const p = String(c.path).replace(/^\\?/, '')
      if (seen.has(p)) return
      seen.add(p)
      const baseScore = 1 - i / Math.max(1, sem.chunks.length)
      groups.push({ path: p, baseScore, chunkText: String(c.text || '') })
    })

    // Tag filter (ALL-of), enrich, scoring
    const tagSet = new Set(tags.map((t: string) => t.toLowerCase()))
    function hasAllTags(entryTags: string[]): boolean {
      if (!tagSet.size) return true
      const lc = new Set((entryTags || []).map((t) => t.toLowerCase()))
      for (const t of tagSet) if (!lc.has(t)) return false
      return true
    }
    function stripPreamble(s: string): string {
      const idx = s.indexOf('\n\n')
      return idx >= 0 ? s.slice(idx + 2) : s
    }

    const results: KbHit[] = []
    for (const g of groups) {
      const meta = byRel[g.path]
      if (!meta) continue
      if (!hasAllTags(meta.tags)) continue
      const body = stripPreamble(g.chunkText)
      const titleMatch = qLower && meta.title.toLowerCase().includes(qLower)
      const literalMatch = qLower && body.toLowerCase().includes(qLower)
      const tagBoost = Array.from(tagSet).filter((t) => meta.tags.map((x) => x.toLowerCase()).includes(t)).length * 0.05
      const score = g.baseScore + (titleMatch ? 0.3 : 0) + (literalMatch ? 0.15 : 0) + tagBoost
      const excerpt = body.slice(0, 320)
      results.push({ ...meta, excerpt, score })
    }

    // Fallback: if semantic returned nothing, do a literal scan (helps just-created docs and CI)
    let finalResults: KbHit[] = results
    if (finalResults.length === 0) {
      try {
        const raw = await import('../../store/utils/knowledgeBase')
        const literal = await raw.search(baseDir, { query: qLower, tags: Array.from(tagSet), limit })
        finalResults = literal
      } catch {}
    }


    finalResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    const limited = finalResults.slice(0, limit)

    return {
      ok: true,
      data: {
        count: limited.length,
        results: limited.map((r) => ({
          id: r.id,
          title: r.title,
          tags: r.tags,
          files: (r as any).files || [],
          path: r.relPath.replace(/^\\?/, ''),
          excerpt: r.excerpt,
          score: r.score ?? 1,
        }))
      }
    }
  }
}

