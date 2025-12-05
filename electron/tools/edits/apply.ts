/**
 * edits.apply tool
 *
 * Apply OpenAI patch, search/replace, or unified diff payloads inside the workspace.
 */

import type { AgentTool } from '../../providers/provider'
import { randomUUID } from 'node:crypto'
import { applyEditsPayload } from './applySmartEngine'

const APPLY_EDITS_DESCRIPTION = [
  '# applyEdits tool',
  '',
  'Use **applyEdits** for precise, surgical modifications to existing workspace files. The tool accepts a *single, plain-text payload* that describes one or more edits. Do **not** wrap the payload in JSON or Markdown code fences.',
  '',
  '## Supported formats',
  '',
  '### 1. Search/Replace blocks',
  '```',
  'File: path/to/file.ts',
  '<<<<<<< SEARCH',
  'old text',
  '=======',
  'new text',
  '>>>>>>> REPLACE',
  '```',
  '- Repeat additional blocks by adding a blank line between them.',
  '- The `SEARCH` section must match the file contents exactly (after normalizing line endings).',
  '',
  '### 2. OpenAI Patch format',
  '```',
  '*** Begin Patch',
  '*** Update File: path/to/file.ts',
  '@@',
  '-old line',
  '+new line',
  '```',
  '- Include at least one `@@` hunk header.',
  '- Context lines (`unchanged`) are optional but recommended when multiple matches exist.',
  '- `*** End Patch` is optional.',
  '',
  '### 3. Unified diff (git-style)',
  '```',
  '--- a/path/to/file.ts',
  '+++ b/path/to/file.ts',
  '@@',
  '-old line',
  '+new line',
  '```',
  '- File paths must be workspace-relative.',
  '',
  '## General rules',
  '- Provide **only** the patch text as the tool input.',
  '- Reference files relative to the workspace root.',
  '- Keep edits minimal—prefer multiple targeted blocks over full rewrites.',
  '- If nothing matches, the tool returns `no-match`; inspect the file and try again.',
].join('\n');

export const applyEditsTool: AgentTool = {
  name: 'applyEdits',
  description: APPLY_EDITS_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      payload: {
        type: 'string',
        description: 'Raw edit payload (OpenAI Patch, unified diff, or Search/Replace blocks). Provide only the patch content; plain text only, no JSON or code fences.'
      }
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

      // Consolidate multiple edits to the same file (Search/Replace blocks
      // create one preview per block, but the UI wants one per file)
      const fileMap = new Map<string, { before: string; after: string }>()

      for (const edit of raw.fileEditsPreview) {
        const path = edit.path
        if (!fileMap.has(path)) {
          fileMap.set(path, { before: edit.before || '', after: edit.after || '' })
        } else {
          const existing = fileMap.get(path)!
          existing.after = edit.after || ''
        }
      }

      let totalAdded = 0
      let totalRemoved = 0
      const files: Array<{ path: string; startLine?: number; endLine?: number }> = []

      for (const [path, { before, after }] of fileMap.entries()) {
        const beforeLines = before.split(/\r?\n/)
        const afterLines = after.split(/\r?\n/)
        const { added, removed } = computeLineDiff(beforeLines, afterLines)
        totalAdded += added
        totalRemoved += removed
        files.push({ path })
      }

      const consolidatedPreviews = Array.from(fileMap.entries()).map(([path, { before, after }]) => ({
        path,
        before,
        after,
        sizeBefore: before.length,
        sizeAfter: after.length,
      }))

      return {
        minimal: {
          ok: !!raw.ok,
          applied: raw.applied ?? 0,
          results: Array.isArray(raw.results) ? raw.results : [],
          previewKey,
          previewCount: fileMap.size,
          files,
          addedLines: totalAdded,
          removedLines: totalRemoved,
        },
        ui: consolidatedPreviews,
        previewKey,
      }
    }

    return { minimal: raw }
  },
}

/**
 * Compute added/removed lines using LCS algorithm (same as BadgeDiffContent).
 */
function computeLineDiff(before: string[], after: string[]): { added: number; removed: number } {
  const n = before.length
  const m = after.length
  if (n === 0 && m === 0) return { added: 0, removed: 0 }

  const LIMIT = 1_000_000
  if (n * m > LIMIT) {
    let i = 0
    let j = 0
    while (i < n && j < m && before[i] === after[j]) {
      i++
      j++
    }
    return { added: m - j, removed: n - i }
  }

  let prev = new Uint32Array(m + 1)
  let curr = new Uint32Array(m + 1)
  for (let i = 1; i <= n; i++) {
    const ai = before[i - 1]
    for (let j = 1; j <= m; j++) {
      curr[j] = ai === after[j - 1] ? prev[j - 1] + 1 : prev[j] > curr[j - 1] ? prev[j] : curr[j - 1]
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }

  const lcs = prev[m]
  return { added: m - lcs, removed: n - lcs }
}
