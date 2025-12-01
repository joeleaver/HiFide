import type { AgentTool } from '../../providers/provider'
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
    if (!meta?.workspaceId) {
      return { ok: false, error: 'workspaceId required in meta' }
    }
    const baseDir = meta.workspaceId

    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (!id) return { ok: false, error: 'id is required' }

    const ok = await deleteItem(baseDir, id)
    if (!ok) return { ok: false, error: 'Not found' }

    // File system watcher will update the service state automatically

    return { ok: true, data: { id } }
  },
}

