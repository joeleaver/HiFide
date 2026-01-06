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

    const stats = await orchestrator.getStats(workspaceId)
    const orchestratorState = orchestrator.getState(workspaceId)
    
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
    const workspaceId = await getConnectionWorkspaceId(connection)
    if (!workspaceId) {
      return { ok: false, error: 'no-active-workspace' }
    }

    // Stop all three indexers
    await orchestrator.stop(workspaceId)
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

  // Set indexing enabled state and persist to settings
  addMethod('indexing.setEnabled', async (params: { enabled: boolean }) => {
    const orchestrator = getIndexOrchestratorService()
    const { getSettingsService } = await import('../../../services/index.js')
    const workspaceId = await getConnectionWorkspaceId(connection)

    if (!workspaceId) {
      return { ok: false, error: 'no-active-workspace' }
    }

    const enabled = params?.enabled ?? true

    // Update orchestrator state
    orchestrator.setIndexingEnabled(workspaceId, enabled)

    // Persist to settings
    const settingsService = getSettingsService()
    settingsService.setVectorSettings({ indexingEnabled: enabled })

    if (enabled) {
      // If enabling, run startup check to index any missing files
      console.log('[indexing-handlers] Indexing enabled, running startup check for workspace:', workspaceId)
      // Use await to ensure startup check completes before returning
      try {
        await orchestrator.runStartupCheck(workspaceId)
        console.log('[indexing-handlers] Startup check completed after enabling')
      } catch (err) {
        console.error('[indexing-handlers] Failed to run startup check after enabling:', err)
      }
    } else {
      // If disabling, stop any active indexing
      const { getKBIndexerService, getMemoriesIndexerService } = await import('../../../services/index.js')
      await orchestrator.stop()
      await getKBIndexerService().stop()
      await getMemoriesIndexerService().stop()
    }

    return { ok: true, enabled }
  })
}
