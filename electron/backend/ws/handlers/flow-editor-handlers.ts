/**
 * Flow Editor RPC handlers
 *
 * Handles flow templates, graph management, profiles, and import/export
 */

import { dialog } from 'electron'
import fs from 'node:fs/promises'
import { getFlowProfileService, getFlowGraphService, getFlowCacheService, getSessionService } from '../../../services/index.js'
import { getConnectionWorkspaceId, type RpcConnection } from '../broadcast.js'

/**
 * Create Flow Editor RPC handlers
 */
export function createFlowEditorHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  addMethod('flowEditor.getTemplates', async () => {
    try {
      const flowProfileService = getFlowProfileService()
      const flowGraphService = getFlowGraphService()
      const workspaceId = await getConnectionWorkspaceId(connection)

      if (!workspaceId) {
        return { ok: false, error: 'No workspace ID' }
      }

      // Get templates from service (already loaded during workspace initialization)
      const allTemplates = flowProfileService.getTemplates(workspaceId)

      // Get selected template from FlowGraphService (independent of session)
      const selectedTemplateId = flowGraphService.getSelectedTemplateId({ workspaceId }) || ''

      // Map to the format expected by the renderer
      const templates = allTemplates.map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        library: t.library
      }))

      return {
        ok: true,
        templates,
        templatesLoaded: true,
        selectedTemplate: selectedTemplateId
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.getGraph', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace bound' }
      }

      const flowGraphService = getFlowGraphService()
      const graph = flowGraphService.getGraph({ workspaceId })
      return { ok: true, nodes: graph.nodes, edges: graph.edges }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.getContexts', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace ID' }
      }

      const sessionService = getSessionService()
      const sessionId = sessionService.getCurrentIdFor({ workspaceId })
      if (!sessionId) {
        return { ok: true, mainContext: null, isolatedContexts: {} }
      }

      const sessions = sessionService.getSessionsFor({ workspaceId })
      const session = sessions.find((s) => s.id === sessionId)

      return {
        ok: true,
        mainContext: session?.currentContext || null,
        isolatedContexts: {} // Isolated contexts removed from architecture
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.getNodeCache', async ({ nodeId }: { nodeId: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      const sessionId = sessionService.getCurrentIdFor({ workspaceId })
      if (!sessionId) return { ok: false, error: 'No current session' }

      const flowCacheService = getFlowCacheService()
      const cache = flowCacheService.getNodeCacheFor({ workspaceId, sessionId, nodeId })
      return { ok: true, cache }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.clearNodeCache', async ({ nodeId }: { nodeId: string }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) return { ok: false, error: 'No workspace bound' }

      const sessionService = getSessionService()
      const sessionId = sessionService.getCurrentIdFor({ workspaceId })
      if (!sessionId) return { ok: false, error: 'No current session' }

      const flowCacheService = getFlowCacheService()
      await flowCacheService.clearNodeCacheFor({ workspaceId, sessionId, nodeId })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.setGraph', async ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace bound' }
      }

      const flowGraphService = getFlowGraphService()
      flowGraphService.setGraph({ workspaceId, nodes, edges })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.loadTemplate', async ({ templateId }: { templateId: string }) => {
    try {
      const flowProfileService = getFlowProfileService()
      const flowGraphService = getFlowGraphService()

      const profile = await flowProfileService.loadTemplate({ templateId })
      if (!profile) return { ok: false, error: 'template-not-found' }

      // Deserialize nodes and edges from storage format to ReactFlow format
      const nodes = profile.nodes.map((n: any) => ({
        id: n.id,
        type: 'hifiNode',
        position: n.position,
        data: {
          nodeType: n.nodeType,
          label: n.label || n.id,
          labelBase: n.label || n.id,
          config: n.config || {},
          expanded: n.expanded || false,
          bp: false,
          onToggleBp: () => {},
        },
      }))

      const edges = profile.edges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }))

      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace bound' }
      }

      // Update the graph in FlowGraphService and track which template is loaded
      flowGraphService.setGraph({ workspaceId, nodes, edges, templateId })

      return { ok: true, nodes, edges }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.saveAsProfile', async ({ name, library, nodes, edges }: { name: string; library?: 'system' | 'user' | 'workspace'; nodes: any[]; edges: any[] }) => {
    try {
      const flowProfileService = getFlowProfileService()
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace ID' }
      }
      await flowProfileService.saveProfile({ workspaceId, name, library: library || 'user', nodes, edges })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.deleteProfile', async ({ name }: { name: string }) => {
    try {
      const flowProfileService = getFlowProfileService()
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace ID' }
      }
      await flowProfileService.deleteProfile({ workspaceId, name })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.createNewFlowNamed', async () => {
    try {
      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace bound' }
      }

      const flowGraphService = getFlowGraphService()
      // Clear the graph to start fresh (name is not stored in service)
      flowGraphService.clearGraph({ workspaceId })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.exportFlow', async ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Flow',
        defaultPath: 'flow.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled || !result.filePath) return { ok: false, canceled: true }

      const data = JSON.stringify({ nodes, edges }, null, 2)
      await fs.writeFile(result.filePath, data, 'utf-8')
      return { ok: true, path: result.filePath }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.importFlow', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Flow',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { ok: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      const content = await fs.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)

      return { ok: true, nodes: data.nodes || [], edges: data.edges || [] }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}
