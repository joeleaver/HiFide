/**
 * Event Subscription Manager
 * 
 * Manages service event subscriptions for WebSocket connections.
 * Eliminates boilerplate by providing a declarative subscription API.
 */

import { getConnectionWorkspaceId } from './broadcast.js'
import type { RpcConnection } from './types'
import {
  getSessionService,
  getTerminalService,
  getKanbanService,
  getKnowledgeBaseService,
  getAppService,
  getFlowGraphService,
  getProviderService,
  getFlowContextsService,
} from '../../services/index.js'

/**
 * Subscription configuration
 */
interface Subscription {
  service: any
  event: string
  handler: (data: any) => void
  workspaceScoped?: boolean // If true, only send when connection is bound to active workspace
}

/**
 * Setup all event subscriptions for a connection
 */
export function setupEventSubscriptions(connection: RpcConnection): () => void {
  const subscriptions: Subscription[] = []

  // Helper to check if connection is bound to a workspace
  const isActiveWorkspace = async (): Promise<boolean> => {
    try {
      const bound = await getConnectionWorkspaceId(connection)
      return !!bound
    } catch {
      return false
    }
  }

  // Helper to add workspace-scoped subscription
  const addWorkspaceSubscription = (
    service: any,
    event: string,
    notificationName: string,
    transform: (data: any) => any
  ) => {
    const handler = async (data: any) => {
      try {
        if (!(await isActiveWorkspace())) return
        const payload = transform(data)
        connection.sendNotification(notificationName, payload)
      } catch { }
    }
    service.on(event, handler)
    subscriptions.push({ service, event, handler, workspaceScoped: true })
  }

  // Helper to add global subscription (no workspace check)
  const addGlobalSubscription = (
    service: any,
    event: string,
    notificationName: string,
    transform: (data: any) => any
  ) => {
    const handler = (data: any) => {
      try {
        const payload = transform(data)
        connection.sendNotification(notificationName, payload)
      } catch { }
    }
    service.on(event, handler)
    subscriptions.push({ service, event, handler, workspaceScoped: false })
  }

  // Terminal tabs
  const terminalService = getTerminalService()
  addWorkspaceSubscription(terminalService, 'terminal:tabs:changed', 'terminal.tabs.changed', (data) => ({
    agentTabs: Array.isArray(data.agentTabs) ? data.agentTabs : [],
    agentActive: data.agentActive || null,
    explorerTabs: Array.isArray(data.explorerTabs) ? data.explorerTabs : [],
    explorerActive: data.explorerActive || null,
  }))

  // Kanban board
  const kanbanService = getKanbanService()
  addWorkspaceSubscription(kanbanService, 'kanban:board:changed', 'kanban.board.changed', (data) => ({
    board: data.board || null,
    loading: !!data.loading,
    saving: !!data.saving,
    error: data.error || null,
    lastLoadedAt: data.lastLoadedAt || null,
  }))

  // Knowledge Base items
  const kbService = getKnowledgeBaseService()
  addWorkspaceSubscription(kbService, 'kb:items:changed', 'kb.items.changed', (data) => ({
    items: data.items || {},
    error: data.error || null,
  }))

  // Knowledge Base workspace files
  addWorkspaceSubscription(kbService, 'kb:workspaceFiles:changed', 'kb.files.changed', (data) => ({
    files: Array.isArray(data.files) ? data.files : [],
  }))

  // App boot status (global - no workspace check)
  const appService = getAppService()
  addGlobalSubscription(appService, 'app:boot:changed', 'app.boot.changed', (data) => ({
    appBootstrapping: !!data.appBootstrapping,
    startupMessage: data.startupMessage || null,
  }))

  // Immediately push current boot status
  try {
    connection.sendNotification('app.boot.changed', {
      appBootstrapping: !!appService.isBootstrapping(),
      startupMessage: appService.getStartupMessage() || null,
    })
  } catch { }

  // Flow Editor graph
  const flowGraphService = getFlowGraphService()
  addWorkspaceSubscription(flowGraphService, 'flowGraph:changed', 'flowEditor.graph.changed', (data) => ({
    selectedTemplate: '', // selectedTemplate is UI-specific, not tracked in FlowGraphService
    nodesCount: Array.isArray(data.nodes) ? data.nodes.length : 0,
    edgesCount: Array.isArray(data.edges) ? data.edges.length : 0,
  }))

  // Provider/models
  const providerService = getProviderService()
  addWorkspaceSubscription(providerService, 'provider:models:changed', 'settings.models.changed', (data) => ({
    providerValid: data.providerValid || {},
    modelsByProvider: data.modelsByProvider || {},
  }))

  // View is now derived from workspace attachment state in renderer
  // No need to send view change notifications

  // Session subscriptions (all workspace-scoped with additional workspaceId check)
  const sessionService = getSessionService()

  // Session usage/costs
  const sessionUsageHandler = async (data: any) => {
    try {
      if (!(await isActiveWorkspace())) return
      const curRoot = await getConnectionWorkspaceId(connection)
      if (data.workspaceId !== curRoot) return

      const sid = sessionService.getCurrentIdFor({ workspaceId: data.workspaceId })
      if (!sid) return

      const sess = Array.isArray(data.sessions) ? data.sessions.find((it: any) => it.id === sid) : null
      if (!sess) return

      const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
      const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
      const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []

      connection.sendNotification('session.usage.changed', { tokenUsage, costs, requestsLog })
    } catch { }
  }
  sessionService.on('sessions:updated', sessionUsageHandler)
  subscriptions.push({ service: sessionService, event: 'sessions:updated', handler: sessionUsageHandler, workspaceScoped: true })

  // Timeline snapshot on session selection
  const timelineSnapshotHandler = async (data: any) => {
    try {
      if (!(await isActiveWorkspace())) return
      const curRoot = await getConnectionWorkspaceId(connection)
      if (data.workspaceId !== curRoot) return

      // Announce selection changes as a first-class event
      try { connection.sendNotification('session.selected', { id: data.sessionId || null }) } catch { }

      const sessions = sessionService.getSessionsFor({ workspaceId: data.workspaceId }) || []
      const sess = Array.isArray(sessions) ? sessions.find((it: any) => it.id === data.sessionId) : null
      const items = Array.isArray(sess?.items) ? sess.items : []
      connection.sendNotification('session.timeline.snapshot', { sessionId: data.sessionId, items })
    } catch { }
  }
  sessionService.on('session:selected', timelineSnapshotHandler)
  subscriptions.push({ service: sessionService, event: 'session:selected', handler: timelineSnapshotHandler, workspaceScoped: true })

  // Session list changes
  const sessionListHandler = async (data: any) => {
    try {
      if (!(await isActiveWorkspace())) return
      const curRoot = await getConnectionWorkspaceId(connection)
      if (data.workspaceId !== curRoot) return

      const sessions = Array.isArray(data.sessions) ? data.sessions.map((s: any) => ({ id: s.id, title: s.title })) : []
      const currentId = sessionService.getCurrentIdFor({ workspaceId: data.workspaceId })
      connection.sendNotification('session.list.changed', { sessions, currentId })
    } catch { }
  }
  sessionService.on('sessions:updated', sessionListHandler)
  subscriptions.push({ service: sessionService, event: 'sessions:updated', handler: sessionListHandler, workspaceScoped: true })

  // Flow contexts changes
  const flowContextsService = getFlowContextsService()
  const flowContextsHandler = async (data: any) => {
    try {
      if (!(await isActiveWorkspace())) return
      const curRoot = await getConnectionWorkspaceId(connection)
      if (data.workspaceId !== curRoot) return

      connection.sendNotification('flow.contexts.changed', {
        requestId: data.requestId || null,
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
        mainContext: data.mainContext || null,
        isolatedContexts: data.isolatedContexts || {},
      })
    } catch { }
  }
  flowContextsService.on('contexts:changed', flowContextsHandler)
  subscriptions.push({ service: flowContextsService, event: 'contexts:changed', handler: flowContextsHandler, workspaceScoped: true })

  // Return cleanup function
  return () => {
    for (const sub of subscriptions) {
      try {
        sub.service.off(sub.event, sub.handler)
      } catch { }
    }
  }
}

