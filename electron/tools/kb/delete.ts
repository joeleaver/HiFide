import type { AgentTool } from '../../providers/provider'
import { deleteItem } from '../../store/utils/knowledgeBase'
import { getVectorService, getKBIndexerService } from '../../services/index.js'

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

    // Remove from vector index and update indexer state
    try {
      const vs = getVectorService()
      const escapedId = id.replace(/'/g, "''")
      // Delete all chunks for this KB article (id starts with kb:${kbId}:)
      await vs.deleteItems('kb', `id LIKE 'kb:${escapedId}:%'`)

      // Also remove from the indexer's tracked state
      const kbIndexer = getKBIndexerService()
      kbIndexer.removeArticle(meta.workspaceId, id)
    } catch (indexErr) {
      console.warn('[knowledgeBaseDelete] Failed to remove from vector index:', indexErr)
      // Don't fail the delete operation if index cleanup fails
    }

    return { ok: true, data: { id } }
  },
}

