/**
 * Workspace Snapshot Builder
 * 
 * Builds a complete snapshot of all workspace state for initial hydration.
 * This eliminates race conditions by sending everything at once.
 */

import type { WorkspaceSnapshot } from '../../../shared/hydration.js'
import {
  getSessionService,
  getProviderService,
  getFlowProfileService,
  getFlowGraphService,
  getKanbanService,
  getKnowledgeBaseService,
  getFlowContextsService,
} from '../../services/index.js'

/**
 * Build a complete workspace snapshot for a given workspace.
 * This is sent to the renderer on connection/workspace binding.
 */
export async function buildWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null> {
  try {
    const sessionService = getSessionService()
    const flowContextsService = getFlowContextsService()
    const providerService = getProviderService()
    const flowProfileService = getFlowProfileService()
    const flowGraphService = getFlowGraphService()
    const kanbanService = getKanbanService()
    const kbService = getKnowledgeBaseService()

    // Get sessions for this workspace
    const sessions = sessionService.getSessionsFor({ workspaceId })
    const currentSessionId = sessionService.getCurrentIdFor({ workspaceId })
    console.log('[snapshot] Building snapshot - currentSessionId:', currentSessionId, 'sessions:', sessions.length)

    // Find the current session
    const currentSession = sessions.find((s: any) => s.id === currentSessionId)
    console.log('[snapshot] Current session found:', !!currentSession, currentSession ? `(${currentSession.title})` : '(none)')

    // Build timeline from current session (items, not timeline)
    const timeline = currentSession?.items || []

    // Get session metadata
    // Provider/model come from the session's currentContext, not from ProviderService
    // This ensures we restore the exact provider/model that was used in this session
    // executedFlowId is the flow being run by scheduler (session panel chooser)
    // If session doesn't have executedFlow, fall back to lastUsedFlow or 'default'
    const meta = {
      executedFlowId: currentSession?.executedFlow || currentSession?.lastUsedFlow || 'default',
      providerId: currentSession?.currentContext?.provider || providerService.getSelectedProvider() || '',
      modelId: currentSession?.currentContext?.model || providerService.getSelectedModel() || '',
    }

    // Get usage stats from current session
    const usage = {
      tokenUsage: currentSession?.tokenUsage,
      costs: currentSession?.costs,
      requestsLog: currentSession?.requestsLog,
    }

    // Get flow editor state
    // getTemplates() returns templates for this workspace
    const allTemplates = flowProfileService.getTemplates(workspaceId) || []

    // On initial load, use the session's executedFlow to initialize the Flow Editor
    // After that, the Flow Editor maintains its own selectedTemplateId independently
    let selectedTemplateId = flowGraphService.getSelectedTemplateId({ workspaceId })
    if (!selectedTemplateId) {
      // First load - initialize from session's executedFlow
      selectedTemplateId = currentSession?.executedFlow || currentSession?.lastUsedFlow || 'default'
    }

    // Load the selected template to get its nodes/edges
    let nodes: any[] = []
    let edges: any[] = []
    try {
      console.log('[snapshot] Loading flow template:', selectedTemplateId)
      const templateGraph = await flowProfileService.loadTemplate({ templateId: selectedTemplateId })
      if (templateGraph) {
        nodes = templateGraph.nodes || []
        edges = templateGraph.edges || []
        console.log('[snapshot] Loaded template graph:', { nodeCount: nodes.length, edgeCount: edges.length })
        console.log('[snapshot] Node types:', nodes.map((n: any) => ({ id: n.id, nodeType: n.nodeType, type: n.type, dataNodeType: n.data?.nodeType })))
        // Also update the FlowGraphService so the scheduler has the graph
        flowGraphService.setGraph({ workspaceId, nodes, edges, templateId: selectedTemplateId })
      } else {
        console.warn('[snapshot] Template not found:', selectedTemplateId)
      }
    } catch (error) {
      console.error('[snapshot] Failed to load template:', selectedTemplateId, error)
    }

    const flowEditor = {
      templates: allTemplates.map((t: any) => ({
        id: t.id,
        name: t.name,
        library: t.library,
      })),
      selectedTemplate: selectedTemplateId,
      nodes,
      edges,
    }

    // Get flow contexts from service (fall back to session state if scheduler hasn't published yet)
    const contextsEntry = flowContextsService.getContextsFor({ workspaceId })
    const flowContexts = {
      requestId: contextsEntry.requestId || null,
      updatedAt: contextsEntry.updatedAt || Date.now(),
      mainContext: contextsEntry.mainContext || currentSession?.currentContext || null,
      isolatedContexts: contextsEntry.isolatedContexts || {},
    }

    // Get kanban board for this workspace
    const kanban = {
      board: kanbanService.getBoard() || null,
    }

    // Get provider/model settings
    const settings = {
      providerValid: {
        openai: providerService.getProviderValid('openai'),
        anthropic: providerService.getProviderValid('anthropic'),
        gemini: providerService.getProviderValid('gemini'),
        fireworks: providerService.getProviderValid('fireworks'),
        xai: providerService.getProviderValid('xai'),
      },
      modelsByProvider: {
        openai: providerService.getModelsForProvider('openai'),
        anthropic: providerService.getModelsForProvider('anthropic'),
        gemini: providerService.getModelsForProvider('gemini'),
        fireworks: providerService.getModelsForProvider('fireworks'),
        xai: providerService.getModelsForProvider('xai'),
      },
    }

    // Get knowledge base items (full data, not just count)
    const kbItems = kbService.getItems()
    const kbFiles = kbService.getWorkspaceFiles()
    const knowledgeBase = {
      items: kbItems,
      files: kbFiles,
    }

    const snapshot: WorkspaceSnapshot = {
      workspaceId,
      workspaceRoot: workspaceId, // Currently using path as ID
      sessions: sessions.map((s: any) => ({ id: s.id, title: s.title || 'Untitled' })),
      currentSessionId,
      timeline,
      meta,
      usage,
      flowEditor,
      flowContexts,
      kanban,
      settings,
      knowledgeBase,
      snapshotTime: Date.now(),
    }
    
    console.log('[snapshot] Built workspace snapshot:', {
      workspaceId,
      sessionCount: sessions.length,
      currentSessionId,
      timelineItems: timeline.length,
      templateCount: allTemplates.length,
      meta,
      flowEditor: {
        templatesCount: flowEditor.templates.length,
        selectedTemplate: flowEditor.selectedTemplate,
        nodesCount: flowEditor.nodes.length,
        edgesCount: flowEditor.edges.length,
      },
      kanbanBoard: !!kanban.board,
      kbItemsCount: Object.keys(kbItems).length,
    })
    
    return snapshot
  } catch (error) {
    console.error('[snapshot] Failed to build workspace snapshot:', error)
    return null
  }
}

/**
 * Send a workspace snapshot to a connection
 */
export async function sendWorkspaceSnapshot(
  connection: { sendNotification: (method: string, params: any) => void },
  workspaceId: string
): Promise<boolean> {
  const snapshot = await buildWorkspaceSnapshot(workspaceId)
  if (!snapshot) {
    connection.sendNotification('hydration.error', {
      phase: 'loading',
      error: 'Failed to build workspace snapshot',
    })
    return false
  }

  try {
    connection.sendNotification('workspace.snapshot', snapshot)
    return true
  } catch (error) {
    console.error('[snapshot] Failed to send workspace snapshot:', error)
    return false
  }
}

