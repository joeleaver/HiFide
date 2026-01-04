/**
 * Indexing Orchestrator RPC handlers
 */

import { getIndexOrchestratorService } from '../../../services/index.js'
import { getConnectionWorkspaceId } from '../broadcast.js'
import type { RpcConnection } from '../types.js'

export function createIndexingHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  // Get current indexing orchestrator status
  addMethod('indexing.getStatus', async () => {
    const orchestrator = getIndexOrchestratorService()
    const workspaceId = await getConnectionWorkspaceId(connection)

    if (!workspaceId) {
      return { ok: false, error: 'no-active-workspace' }
    }

    const stats = await orchestrator.getStats()
    const orchestratorState = orchestrator.getState()
    
    return {
      ok: true,
      ...stats,
      workspaceId,
      // Detailed counts
      code: orchestratorState.code,
      kb: orchestratorState.kb,
      memories: orchestratorState.memories,
      indexingEnabled: orchestratorState.indexingEnabled,
    }
  })

  // Start indexing for the workspace (all three indexers without forcing)
  addMethod('indexing.start', async () => {
    const orchestrator = getIndexOrchestratorService()
    const { getKBIndexerService, getMemoriesIndexerService } = await import('../../../services/index.js')
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'no-active-workspace' }
    }

    // Start all three indexers without forcing (resume from where left off)
    await orchestrator.start(workspaceId)
    await getKBIndexerService().indexWorkspace(workspaceId, false)
    await getMemoriesIndexerService().indexWorkspace(workspaceId, false)
    return { ok: true }
  })

  // Stop indexing (all three indexers)
  addMethod('indexing.stop', async () => {
    const orchestrator = getIndexOrchestratorService()
    const { getKBIndexerService, getMemoriesIndexerService } = await import('../../../services/index.js')

    // Stop all three indexers
    await orchestrator.stop()
    await getKBIndexerService().stop()
    await getMemoriesIndexerService().stop()
    return { ok: true }
  })

  // Re-index workspace
  addMethod('indexing.reindex', async (params: { force?: boolean }) => {
    const orchestrator = getIndexOrchestratorService()
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'no-active-workspace' }
    }
    await orchestrator.indexAll(params?.force || false, workspaceId)
    return { ok: true }
  })
}
