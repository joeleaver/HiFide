/**
 * Flow Editor RPC handlers
 *
 * Handles flow templates, graph management, profiles, and import/export
 */

import { dialog } from 'electron'
import fs from 'node:fs/promises'
import { getFlowProfileService, getFlowGraphService, getFlowCacheService, getSessionService, getFlowContextsService } from '../../../services/index.js'
import { persistAutosaveSnapshot } from '../../../services/flowAutosave.js'
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

      // Log what we're about to send
      if (graph.nodes.length > 0) {
        const sample = graph.nodes[0]
        console.log('[flowEditor.getGraph] About to send sample node:', {
          id: sample.id,
          type: sample.type,
          dataKeys: sample.data ? Object.keys(sample.data) : [],
          dataNodeType: (sample.data as any)?.nodeType,
          dataConfig: (sample.data as any)?.config
        })
      }

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
      const sessions = sessionService.getSessionsFor({ workspaceId })
      const session = sessionId ? sessions.find((s) => s.id === sessionId) : null

      const flowContextsService = getFlowContextsService()
      const entry = flowContextsService.getContextsFor({ workspaceId })
      return {
        ok: true,
        requestId: entry.requestId || null,
        updatedAt: entry.updatedAt || Date.now(),
        mainContext: entry.mainContext || session?.currentContext || null,
        isolatedContexts: entry.isolatedContexts || {},
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
      console.log('[flowEditor.setGraph] Called with nodeCount:', nodes?.length, 'edgeCount:', edges?.length)

      // Log sample node to see what format we're receiving
      if (nodes && nodes.length > 0) {
        const sampleNode = nodes[0]
        console.log('[flowEditor.setGraph] Sample node from renderer:', {
          id: sampleNode.id,
          type: sampleNode.type,
          topLevelNodeType: sampleNode.nodeType,  // Should be undefined (wrong format)
          dataNodeType: sampleNode.data?.nodeType,  // Should have value (correct format)
          hasData: !!sampleNode.data,
          dataKeys: sampleNode.data ? Object.keys(sampleNode.data).slice(0, 10) : []
        })

        const nodesWithConfig = nodes.filter(n => n.data?.config && Object.keys(n.data.config).length > 0)
        console.log('[flowEditor.setGraph] Nodes with config:', nodesWithConfig.map(n => ({
          id: n.id,
          nodeType: n.data?.nodeType,
          config: n.data?.config
        })))
      }

      const workspaceId = await getConnectionWorkspaceId(connection)
      console.log('[flowEditor.setGraph] workspaceId:', workspaceId)
      if (!workspaceId) {
        console.warn('[flowEditor.setGraph] No workspace bound, cannot save graph')
        return { ok: false, error: 'No workspace bound' }
      }

      const flowGraphService = getFlowGraphService()
      flowGraphService.setGraph({ workspaceId, nodes, edges, reason: 'autosave' })

      // Auto-save user and workspace flows to disk (system flows are read-only)
      const selectedTemplateId = flowGraphService.getSelectedTemplateId({ workspaceId })

      if (selectedTemplateId) {
        const flowProfileService = getFlowProfileService()
        const templates = flowProfileService.getTemplates(workspaceId)
        const template = templates.find((t: any) => t.id === selectedTemplateId)

        if (template && (template.library === 'workspace' || template.library === 'user')) {
          console.log('[flowEditor.setGraph] Auto-saving flow:', { templateId: selectedTemplateId, library: template.library })
          try {
            await persistAutosaveSnapshot({
              workspaceId,
              templateId: selectedTemplateId,
              library: template.library,
              description: template.description || '',
              nodes,
              edges,
            })
            console.log('[flowEditor.setGraph] Flow auto-saved successfully')
          } catch (e: any) {
            console.error('[flowEditor.setGraph] Failed to auto-save flow:', e)
          }
        } else if (template && template.library === 'system') {
          console.log('[flowEditor.setGraph] Skipping auto-save for system flow (read-only):', selectedTemplateId)
        }
      }

      console.log('[flowEditor.setGraph] Graph saved successfully')
      return { ok: true }
    } catch (e: any) {
      console.error('[flowEditor.setGraph] Error:', e)
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flowEditor.loadTemplate', async ({ templateId }: { templateId: string }) => {
    try {
      const flowProfileService = getFlowProfileService()
      const flowGraphService = getFlowGraphService()


      const workspaceId = await getConnectionWorkspaceId(connection)
      if (!workspaceId) {
        return { ok: false, error: 'No workspace bound' }
      }

      const profile = await flowProfileService.loadTemplate({ templateId, workspaceId })
      if (!profile) return { ok: false, error: 'template-not-found' }

      // profile.nodes and profile.edges are already in ReactFlow format
      // (deserialized by loadFlowTemplate in flowProfiles.ts)
      // DO NOT re-deserialize - that loses data.nodeType and data.config!
      const { nodes, edges } = profile

      // Update the graph in FlowGraphService and track which template is loaded
      flowGraphService.setGraph({ workspaceId, nodes, edges, templateId, reason: 'template-load' })

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
