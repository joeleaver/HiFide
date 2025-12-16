/**
 * Memories RPC handlers
 *
 * Workspace-scoped long-term memory store CRUD.
 * Storage: .hifide-public/memories.json
 */

import { getConnectionWorkspaceId } from '../broadcast.js'
import type { RpcConnection } from '../types'
import { cleanupDeprecatedMemoriesSettings, readWorkspaceMemories, writeWorkspaceMemories } from '../../../store/utils/memories'
import type { WorkspaceMemoryItem } from '../../../store/utils/memories'


export function createMemoriesHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  addMethod('memories.list', async () => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      // One-time cleanup/migration for deprecated settings keys like `settings.ruleToggles`.
      await cleanupDeprecatedMemoriesSettings(baseDir)
      const file = await readWorkspaceMemories(baseDir)
      // Backward-compat: if settings are missing, normalize + persist once.
      if (!file.settings) {
        await writeWorkspaceMemories(file, baseDir)
      }
      return { ok: true, items: file.items }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('memories.upsert', async ({ item }: { item: WorkspaceMemoryItem }) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }

      const file = await readWorkspaceMemories(baseDir)
      const nextItems = file.items.filter((m) => m.id !== item.id)
      nextItems.unshift({ ...item, updatedAt: new Date().toISOString() })
      const next = { ...file, items: nextItems }
      await writeWorkspaceMemories(next, baseDir)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


  addMethod('memories.delete', async ({ id }: { id: string }) => {
    try {
      const baseDir = await getConnectionWorkspaceId(connection)
      if (!baseDir) return { ok: false, error: 'no-workspace' }
      const file = await readWorkspaceMemories(baseDir)
      const next = { ...file, items: file.items.filter((m) => m.id !== id) }
      await writeWorkspaceMemories(next, baseDir)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

}

