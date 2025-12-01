import type { AgentTool } from '../../providers/provider'
import { randomUUID } from 'node:crypto'
import { applyEditsPayload } from './applySmartEngine'

export const applyEditsTool: AgentTool = {
  name: 'applyEdits',
  description: `Unified file edits. One parameter: payload (string). Auto-detects format; preserves EOL/BOM/indent; respects .gitignore and denylist (.hifide-private/.hifide-public). Always allows create/delete/partial.

Use one of these formats (auto-detected):

1) Search/Replace (recommended)
File: path/to/file.ts
<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE

2) OpenAI Patch
*** Begin Patch
*** Update File: path/to/file.ts
@@
-old line
+new line

3) Unified diff (git-style) also accepted.`,
  parameters: {
    type: 'object',
    properties: {
      payload: { type: 'string', description: 'Raw edit payload (OpenAI Patch, unified diff, or Search/Replace blocks). Provide only the patch content; plain text only (no JSON wrapper, no code fences).' }
    },
    required: ['payload'],
    additionalProperties: false
  },
  run: async ({ payload }: { payload: string }, meta?: any) => {
    try {
      return await applyEditsPayload(String(payload || ''), meta?.workspaceId)
    } catch (e: any) {
      return { ok: false, applied: 0, results: [], error: e?.message || String(e) }
    }
  },
  toModelResult: (raw: any) => {
    if (raw?.fileEditsPreview && Array.isArray(raw.fileEditsPreview)) {
      const previewKey = randomUUID()

      // Consolidate multiple edits to the same file
      // (Search/Replace blocks create one preview per block, but we want one preview per file)
      const fileMap = new Map<string, { before: string; after: string }>()

      for (const edit of raw.fileEditsPreview) {
        const path = edit.path
        if (!fileMap.has(path)) {
          // First edit to this file - use its before/after
          fileMap.set(path, { before: edit.before || '', after: edit.after || '' })
        } else {
          // Subsequent edit to same file - update only the 'after' state
          // (the 'before' from first edit is the original state)
          const existing = fileMap.get(path)!
          existing.after = edit.after || ''
        }
      }

      // Calculate total added/removed lines across all unique files
      let totalAdded = 0
      let totalRemoved = 0
      const files: Array<{ path: string; startLine?: number; endLine?: number }> = []

      for (const [path, { before, after }] of fileMap.entries()) {
        // Use simple line-based diff calculation
        const beforeLines = before.split(/\r?\n/)
        const afterLines = after.split(/\r?\n/)

        // Simple LCS-based diff to count actual added/removed lines
        const { added, removed } = computeLineDiff(beforeLines, afterLines)

        totalAdded += added
        totalRemoved += removed

        files.push({ path })
      }

      // Consolidate UI preview data (one entry per unique file)
      const consolidatedPreviews = Array.from(fileMap.entries()).map(([path, { before, after }]) => ({
        path,
        before,
        after,
        sizeBefore: before.length,
        sizeAfter: after.length
      }))

      return {
        minimal: {
          ok: !!raw.ok,
          applied: raw.applied ?? 0,
          results: Array.isArray(raw.results) ? raw.results : [],
          previewKey,
          previewCount: fileMap.size, // Count unique files, not total blocks
          files,
          addedLines: totalAdded,
          removedLines: totalRemoved
        },
        ui: consolidatedPreviews, // Consolidated preview data
        previewKey
      }
    }
    return { minimal: raw }
  },
}

/**
 * Compute added/removed lines using LCS algorithm (same as BadgeDiffContent)
 */
function computeLineDiff(before: string[], after: string[]): { added: number; removed: number } {
  const n = before.length
  const m = after.length
  if (n === 0 && m === 0) return { added: 0, removed: 0 }

  const LIMIT = 1_000_000
  if (n * m > LIMIT) {
    // Fast path for very large files: just count prefix match
    let i = 0, j = 0
    while (i < n && j < m && before[i] === after[j]) { i++; j++ }
    return { added: (m - j), removed: (n - i) }
  }

  // LCS dynamic programming
  let prev = new Uint32Array(m + 1)
  let curr = new Uint32Array(m + 1)
  for (let i = 1; i <= n; i++) {
    const ai = before[i - 1]
    for (let j = 1; j <= m; j++) {
      curr[j] = ai === after[j - 1] ? (prev[j - 1] + 1) : (prev[j] > curr[j - 1] ? prev[j] : curr[j - 1])
    }
    const tmp = prev; prev = curr; curr = tmp
    curr.fill(0)
  }
  const lcs = prev[m]
  return { added: m - lcs, removed: n - lcs }
}

