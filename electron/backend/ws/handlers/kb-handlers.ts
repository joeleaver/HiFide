/**
 * Knowledge Base RPC handlers
 *
 * Handles KB item CRUD, search, and workspace file indexing
 */

import { readById, listItems, createItem, updateItem, deleteItem } from '../../../store/utils/knowledgeBase'
import { listWorkspaceFiles } from '../../../store/utils/workspace-helpers'
import { getConnectionWorkspaceId } from '../broadcast.js'
import type { RpcConnection } from '../types'
import { getVectorService, getKBIndexerService } from '../../../services/index.js'

/**
 * Create Knowledge Base RPC handlers
 */
export function createKbHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  addMethod('kb.getItemBody', async ({ id }: { id: string }) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
console.log('Base Directory:', baseDir);
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      const item = await readById(baseDir, id)
console.log('Retrieved Item:', item);
      if (!item) return { ok: false, error: 'not-found' }
      return { ok: true, item }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })



  addMethod('kb.search', async () => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      const items = await listItems(baseDir)
      // TODO: Apply query, tags, limit filtering
      return { ok: true, items }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.createItem', async ({ title, description, tags, files }: { title: string; description: string; tags?: string[]; files?: string[] }) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      const item = await createItem(baseDir, { title, description, tags, files })
      return { ok: true, item }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.updateItem', async ({ id, patch }: { id: string; patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }> }) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      const item = await updateItem(baseDir, { id, patch })
      return { ok: true, item }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.deleteItem', async ({ id }: { id: string }) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      await deleteItem(baseDir, id)

      // Remove from vector index and update indexer state
      // KB articles are stored with IDs like kb:${kbId}:${chunkIndex}, so we need to delete all chunks
      try {
        const vs = getVectorService()
        const escapedId = id.replace(/'/g, "''")
        // Delete all chunks for this KB article (id starts with kb:${kbId}:)
        await vs.deleteItems('kb', `id LIKE 'kb:${escapedId}:%'`)

        // Also remove from the indexer's tracked state so it doesn't think it's still indexed
        const kbIndexer = getKBIndexerService()
        if (kbIndexer.state.indexedArticles[id]) {
          const { [id]: _, ...rest } = kbIndexer.state.indexedArticles
          kbIndexer.setState({ indexedArticles: rest })
        }
      } catch (indexErr) {
        console.warn('[kb.deleteItem] Failed to remove from vector index:', indexErr)
        // Don't fail the delete operation if index cleanup fails
      }

      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.refreshWorkspaceFileIndex', async ({ includeExts, max }: { includeExts?: string[]; max?: number } = {}) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      const files = await listWorkspaceFiles(baseDir, { includeExts, max })
      return { ok: true, files }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

