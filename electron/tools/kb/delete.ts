import type { AgentTool } from '../../providers/provider'
import { useMainStore } from '../../store'
import { deleteItem } from '../../store/utils/knowledgeBase'

export const knowledgeBaseDeleteTool: AgentTool = {
  name: 'knowledgeBaseDelete',
  description:
    'Delete a Knowledge Base entry by id. Removes the underlying markdown file from .hifide-public/kb. Use with caution.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Existing KB item id to delete.' },
    },
    required: ['id'],
  },
  run: async (input: any, meta?: any) => {
    const baseDir = meta?.workspaceId || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()

    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (!id) return { ok: false, error: 'id is required' }

    const ok = await deleteItem(baseDir, id)
    if (!ok) return { ok: false, error: 'Not found' }

    // Immediate best-effort store update to broadcast events without waiting for fs watcher
    try {
      (useMainStore as any).setState?.((s: any) => {
        const map = { ...(s?.kbItems || {}) }
        delete map[id]
        return { kbItems: map }
      })
    } catch {}

    return { ok: true, data: { id } }
  },
}

