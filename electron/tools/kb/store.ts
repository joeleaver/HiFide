import type { AgentTool } from '../../providers/provider'
import { createItem, normalizeMarkdown } from '../../store/utils/knowledgeBase'
import { ServiceRegistry } from '../../services/base/ServiceRegistry.js'

export const knowledgeBaseStoreTool: AgentTool = {
  name: 'knowledgeBaseStore',
  description: 'Create or update Knowledge Base entries (single source of truth). Do not write markdown files directly; persist via this tool and associate related workspace files as needed.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Existing KB item id to update. Omit to create a new entry.' },
      title: { type: 'string', description: 'Concise human-readable title. Required for create; optional for update.' },
      description: { type: 'string', description: 'Markdown body of the entry. Keep concise and factual. Required for create; optional for update (must be non-empty when provided).' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags to assign (replaces existing tags on update). Prefer small, reusable tags.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative source file paths this entry documents. Use to link docs to code. Do not create or modify files directly.' }
    },
    required: [],
  },
  run: async (input: any, meta?: any) => {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const baseDir = meta?.workspaceId || workspaceService?.getWorkspaceRoot() || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
    const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : undefined
    const title = typeof input?.title === 'string' ? input.title : undefined
    const description = typeof input?.description === 'string' ? input.description : undefined
    const tags = Array.isArray(input?.tags) ? input.tags : undefined
    const files = Array.isArray(input?.files) ? input.files : undefined

    if (!id) {
      // Create
      if (!title || !description || !String(description).trim()) {
        return { ok: false, error: 'Missing required fields for create: title, description' }
      }
      const item = await createItem(baseDir, { title, description: normalizeMarkdown(description), tags, files })
      try {
        const kbService = ServiceRegistry.get<any>('knowledgeBase')
        if (kbService) {
          kbService.setState({ kbItems: { ...kbService.getItems(), [item.id]: item } })
        }
      } catch {}
      return { ok: true, data: { id: item.id, path: item.relPath, title: item.title, tags: item.tags, files: item.files } }
    } else {
      // Update
      if (!title && !description && !tags && !files) {
        return { ok: false, error: 'Nothing to update: provide at least one of title, description, tags, files' }
      }
      const updated = await (async () => {
        const res = await import('../../store/utils/knowledgeBase')
        const descPatch = description !== undefined ? res.normalizeMarkdown(description) : undefined
        return res.updateItem(baseDir, { id, patch: { title, description: descPatch, tags, files } })
      })()
      if (!updated) return { ok: false, error: 'Not found' }
      try {
        const kbService = ServiceRegistry.get<any>('knowledgeBase')
        if (kbService) {
          kbService.setState({ kbItems: { ...kbService.getItems(), [updated.id]: updated } })
        }
      } catch {}
      return { ok: true, data: { id: updated.id, path: updated.relPath, title: updated.title, tags: updated.tags, files: updated.files } }
    }
  }
}

