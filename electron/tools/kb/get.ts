import type { AgentTool } from '../../providers/provider'
import { readById } from '../../store/utils/knowledgeBase'
import { randomUUID } from 'node:crypto'

export const knowledgeBaseGetTool: AgentTool = {
  name: 'knowledgeBaseGet',
  description: 'Retrieve the full content of a Knowledge Base entry by its ID. Returns the raw markdown body and metadata.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The unique ID of the Knowledge Base entry to retrieve.' }
    },
    required: ['id']
  },
  run: async (input: any, meta?: any) => {
    if (!meta?.workspaceId) {
      return { ok: false, error: 'workspaceId required in meta' }
    }
    const id = typeof input?.id === 'string' ? input.id : ''
    if (!id) {
      return { ok: false, error: 'Knowledge Base entry ID is required' }
    }

    const result = await readById(meta.workspaceId, id)
    if (!result) {
      return { ok: false, error: `Knowledge Base entry with ID "${id}" not found` }
    }

    return {
      ok: true,
      data: {
        id: result.meta.id,
        title: result.meta.title,
        tags: result.meta.tags,
        files: result.meta.files,
        createdAt: result.meta.createdAt,
        updatedAt: result.meta.updatedAt,
        content: result.body
      }
    }
  },

  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const previewKey = randomUUID()
      return {
        minimal: raw.data,
        ui: raw.data,
        previewKey
      }
    }
    return { minimal: raw }
  }
}
