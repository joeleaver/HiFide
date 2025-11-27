/**
 * Workspace Snapshot Builder
 * 
 * Builds a complete snapshot of all workspace state for initial hydration.
 * This eliminates race conditions by sending everything at once.
 */

import type { WorkspaceSnapshot } from '../../../shared/hydration.js'
import { ServiceRegistry } from '../../services/base/ServiceRegistry.js'

/**
 * Build a complete workspace snapshot for a given workspace.
 * This is sent to the renderer on connection/workspace binding.
 */
export function buildWorkspaceSnapshot(workspaceId: string): WorkspaceSnapshot | null {
  try {
    const sessionService = ServiceRegistry.get<any>('session')
    if (!sessionService) return null

    // Get sessions for this workspace
    const sessionsByWorkspace = sessionService.getSessionsByWorkspace() || {}
    const sessions = sessionsByWorkspace[workspaceId] || []
    const currentIdByWorkspace = state.currentIdByWorkspace || {}
    const currentSessionId = currentIdByWorkspace[workspaceId] || null
    
    // Find the current session
    const currentSession = sessions.find((s: any) => s.id === currentSessionId)
    
    // Build timeline from current session
    const timeline = currentSession?.timeline || []
    
    // Get session metadata
    const meta = {
      executedFlowId: currentSession?.lastUsedFlow || state.feSelectedTemplate || '',
      providerId: state.selectedProvider || '',
      modelId: state.selectedModel || '',
    }
    
    // Get usage stats from current session
    const usage = {
      tokenUsage: currentSession?.tokenUsage,
      costs: currentSession?.costs,
      requestsLog: currentSession?.requestsLog,
    }
    
    // Get flow editor state
    const templates = state.feAvailableTemplates || []
    const flowEditor = {
      templates: templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        library: t.library,
      })),
      selectedTemplate: state.feSelectedTemplate || '',
      nodes: state.feNodes || [],
      edges: state.feEdges || [],
    }
    
    // Get kanban board for this workspace
    const kanbanByWorkspace = state.kanbanByWorkspace || {}
    const kanban = {
      board: kanbanByWorkspace[workspaceId] || null,
    }
    
    // Get provider/model settings
    const settings = {
      providerValid: state.providerValid || {},
      modelsByProvider: state.modelsByProvider || {},
    }
    
    // Get knowledge base summary
    const kbItems = state.kbItems || {}
    const knowledgeBase = {
      itemCount: Object.keys(kbItems).length,
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
      templateCount: templates.length,
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
export function sendWorkspaceSnapshot(
  connection: { sendNotification: (method: string, params: any) => void },
  workspaceId: string
): boolean {
  const snapshot = buildWorkspaceSnapshot(workspaceId)
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

