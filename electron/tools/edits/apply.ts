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
  run: async ({ payload }: { payload: string }) => {
    try {
      return await applyEditsPayload(String(payload || ''))
    } catch (e: any) {
      return { ok: false, applied: 0, results: [], error: e?.message || String(e) }
    }
  },
  toModelResult: (raw: any) => {
    if (raw?.fileEditsPreview && Array.isArray(raw.fileEditsPreview)) {
      const previewKey = randomUUID()
      return {
        minimal: {
          ok: !!raw.ok,
          applied: raw.applied ?? 0,
          results: Array.isArray(raw.results) ? raw.results : [],
          previewKey,
          previewCount: raw.fileEditsPreview.length
        },
        ui: raw.fileEditsPreview,
        previewKey
      }
    }
    return { minimal: raw }
  },
}

