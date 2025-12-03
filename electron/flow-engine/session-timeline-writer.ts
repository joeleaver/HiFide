
import { ServiceRegistry } from '../services/base/ServiceRegistry.js'
import { getWorkspaceIdForSessionId } from '../utils/workspace-session.js'
import type { NodeExecutionBox } from '../store/types.js'
import { broadcastWorkspaceNotification } from '../backend/ws/broadcast.js'

/**
 * Handles the "dirty work" of finding a session, updating its timeline items,
 * persisting to disk, and broadcasting deltas to the frontend.
 */
export class SessionTimelineWriter {
  private workspaceService: any
  private sessionService: any

  constructor(
    private sessionId: string,
    private nodeMeta: Map<string, { label: string; kind: string }>
  ) {
    const registry = ServiceRegistry.getInstance()
    this.workspaceService = registry.get('workspace')
    this.sessionService = registry.get('session')
  }

  /**
   * Updates the session items for a specific node/execution.
   * Handles box creation, content appending, and persistence.
   */
  public write(
    nodeId: string,
    executionId: string | undefined,
    data: {
      text?: string
      reasoning?: string
      toolCalls?: any[]
      boxId?: string
    }
  ): string {
    const { text, reasoning, toolCalls = [], boxId: existingBoxId } = data
    if (!text && !reasoning && toolCalls.length === 0) return existingBoxId || ''

    const ws = this.getWorkspaceId()
    if (!ws) return existingBoxId || ''

    const { session, index, allSessions } = this.getSession(ws)
    if (!session) return existingBoxId || ''

    const items = Array.isArray(session.items) ? [...session.items] : []
    let boxId = existingBoxId

    // 1. Find or Create Box
    if (!boxId) {
      boxId = `box-${nodeId}-${executionId || Date.now()}`
      
      const meta = this.nodeMeta.get(nodeId) || { label: 'Node', kind: 'unknown' }
      const newBox: NodeExecutionBox = {
        type: 'node-execution',
        id: boxId,
        nodeId,
        nodeLabel: meta.label,
        nodeKind: meta.kind,
        timestamp: Date.now(),
        content: [],
      }

      // Initial content
      if (reasoning) newBox.content.push({ type: 'reasoning', text: reasoning })
      if (text) newBox.content.push({ type: 'text', text })
      for (const tool of toolCalls) {
        newBox.content.push({ type: 'badge', badge: tool })
      }

      items.push(newBox)
    } else {
      // Update Existing Box
      const boxIndex = items.findIndex((item: any) => item.id === boxId)
      if (boxIndex >= 0) {
        const box = { ...items[boxIndex] } as NodeExecutionBox
        const content = [...box.content]

        if (reasoning) content.push({ type: 'reasoning', text: reasoning })
        if (text) content.push({ type: 'text', text })

        for (const tool of toolCalls) {
          // Update or Append Badge
          const existingIndex = content.findIndex(
            (item: any) => item.type === 'badge' && item.badge?.callId === tool.callId
          )
          if (existingIndex >= 0) {
            content[existingIndex] = { type: 'badge', badge: tool }
          } else {
            content.push({ type: 'badge', badge: tool })
          }
        }
        items[boxIndex] = { ...box, content }
      }
    }

    // 2. Persist to Session Service
    allSessions[index] = { ...session, items, updatedAt: Date.now() }
    this.sessionService.setSessionsFor({ workspaceId: ws, sessions: allSessions })
    
    // 3. Persist to Disk (Debounced)
    this.sessionService.saveSessionFor({ workspaceId: ws, sessionId: this.sessionId }, false)

    // 4. Broadcast Deltas
    this.broadcastDeltas(ws, nodeId, executionId, text, reasoning, toolCalls)

    return boxId
  }

  /**
   * Updates session usage stats, costs, and requests log.
   */
  public updateUsage(ev: {
    usage: any
    cost?: any
    provider: string
    model: string
    requestId: string
    nodeId: string
    executionId: string
  }) {
    const ws = this.getWorkspaceId()
    if (!ws) return

    const { session, index, allSessions } = this.getSession(ws)
    if (!session) return

    const tokenUsage = session.tokenUsage || {
      total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 },
      byProvider: {},
      byProviderAndModel: {},
    }

    // Update totals
    tokenUsage.total.inputTokens += ev.usage.inputTokens || 0
    tokenUsage.total.outputTokens += ev.usage.outputTokens || 0
    tokenUsage.total.totalTokens += ev.usage.totalTokens || 0
    tokenUsage.total.cachedTokens += ev.usage.cachedTokens || 0

    // Update by provider
    const providerKey = ev.provider
    if (!tokenUsage.byProvider[providerKey]) {
      tokenUsage.byProvider[providerKey] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      }
    }
    tokenUsage.byProvider[providerKey].inputTokens += ev.usage.inputTokens || 0
    tokenUsage.byProvider[providerKey].outputTokens += ev.usage.outputTokens || 0
    tokenUsage.byProvider[providerKey].totalTokens += ev.usage.totalTokens || 0
    tokenUsage.byProvider[providerKey].cachedTokens += ev.usage.cachedTokens || 0

    // Update by provider and model (Nested: provider -> model -> usage)
    if (!tokenUsage.byProviderAndModel) {
      tokenUsage.byProviderAndModel = {}
    }
    if (!tokenUsage.byProviderAndModel[providerKey]) {
      tokenUsage.byProviderAndModel[providerKey] = {}
    }
    const modelKey = ev.model
    if (!tokenUsage.byProviderAndModel[providerKey][modelKey]) {
      tokenUsage.byProviderAndModel[providerKey][modelKey] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      }
    }
    tokenUsage.byProviderAndModel[providerKey][modelKey].inputTokens += ev.usage.inputTokens || 0
    tokenUsage.byProviderAndModel[providerKey][modelKey].outputTokens += ev.usage.outputTokens || 0
    tokenUsage.byProviderAndModel[providerKey][modelKey].totalTokens += ev.usage.totalTokens || 0
    tokenUsage.byProviderAndModel[providerKey][modelKey].cachedTokens += ev.usage.cachedTokens || 0

    // Update costs
    const costs = session.costs || {
      totalCost: 0,
      currency: 'USD',
      byProviderAndModel: {}
    }

    if (ev.cost) {
      costs.totalCost += ev.cost.totalCost || 0
      
      if (!costs.byProviderAndModel) costs.byProviderAndModel = {}
      if (!costs.byProviderAndModel[providerKey]) costs.byProviderAndModel[providerKey] = {}
      
      if (!costs.byProviderAndModel[providerKey][modelKey]) {
        costs.byProviderAndModel[providerKey][modelKey] = {
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          currency: 'USD'
        }
      }
      
      costs.byProviderAndModel[providerKey][modelKey].inputCost += ev.cost.inputCost || 0
      costs.byProviderAndModel[providerKey][modelKey].outputCost += ev.cost.outputCost || 0
      costs.byProviderAndModel[providerKey][modelKey].totalCost += ev.cost.totalCost || 0
    }

    // Append to requestsLog
    const requestsLog = Array.isArray(session.requestsLog) ? [...session.requestsLog] : []
    requestsLog.push({
      requestId: ev.requestId,
      nodeId: ev.nodeId,
      executionId: ev.executionId,
      provider: ev.provider,
      model: ev.model,
      timestamp: Date.now(),
      usage: ev.usage,
      cost: ev.cost // Might be undefined, but we pass it through if available
    })

    // Save updated usage/costs/requests to the session only when we have actual usage
    // (i.e., on usage_breakdown / final usage events). This method is only called
    // from those events, so we do NOT need to call it on every chunk.
    allSessions[index] = {
      ...session,
      tokenUsage,
      costs,
      requestsLog,
      updatedAt: Date.now(),
    }

    this.sessionService.setSessionsFor({ workspaceId: ws, sessions: allSessions })
    this.sessionService.saveCurrentSession() // Debounced
    
    // Broadcast consolidated usage snapshot to all renderers.
    // This should only be invoked when we have real usage data (after the LLM
    // returns usage / usage_breakdown), not on every streaming chunk.
    broadcastWorkspaceNotification(ws, 'session.usage.changed', {
      tokenUsage,
      costs,
      requestsLog,
    })
  }

  private broadcastDeltas(
    ws: string, 
    nodeId: string, 
    executionId: string | undefined,
    text: string | undefined, 
    reasoning: string | undefined, 
    toolCalls: any[]
  ) {
    // Text/Reasoning Delta
    if (text || reasoning) {
      broadcastWorkspaceNotification(ws, 'session.timeline.delta', {
        op: 'appendToBox',
        nodeId,
        executionId,
        append: {
          text: text || undefined,
          reasoning: reasoning || undefined,
        },
      })
    }

    // Tool Badge Deltas
    for (const badge of toolCalls) {
      const isUsageBadge = badge.toolName === 'usageBreakdown' || badge.contentType === 'usage-breakdown'
      // Treat 'running' badges or usage badges as "New" -> appendToBox
      // Treat others as "Updates" -> updateBadge
      const isNew = badge.status === 'running' || isUsageBadge

      broadcastWorkspaceNotification(ws, 'session.timeline.delta', {
        op: isNew ? 'appendToBox' : 'updateBadge',
        nodeId,
        executionId,
        callId: badge.callId,
        append: isNew ? { badges: [badge] } : undefined,
        updates: !isNew ? badge : undefined,
      })
    }
  }

  private getWorkspaceId(): string | null {
    return getWorkspaceIdForSessionId(this.sessionId) || this.workspaceService.getWorkspaceRoot()
  }

  private getSession(ws: string) {
    const sessions = this.sessionService.getSessionsFor({ workspaceId: ws })
    const index = sessions.findIndex((s: any) => s.id === this.sessionId)
    return { 
      session: index >= 0 ? sessions[index] : null, 
      index, 
      allSessions: [...sessions] 
    }
  }
}
