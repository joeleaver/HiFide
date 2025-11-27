/**
 * Session Service
 *
 * Manages chat session CRUD operations including:
 * - Session CRUD (create, read, update, delete)
 * - Token usage and cost tracking (in-flight and finalized)
 * - Session persistence
 *
 * Delegates to specialized services for:
 * - SessionTimelineService: Timeline items, node execution boxes, badges
 * - FlowCacheService: Flow node cache
 */

import { Service } from './base/Service.js'
import type { Session, ActivityEvent, TokenUsage, TokenCost } from '../store/types.js'
import { MAX_SESSIONS } from '../store/utils/constants.js'
import { deriveTitle, initialSessionTitle } from '../store/utils/sessions.js'
import { loadAllSessions, sessionSaver, deleteSessionFromDisk } from '../store/utils/session-persistence.js'
import { ServiceRegistry } from './base/ServiceRegistry.js'

const DEBUG_USAGE = process.env.HF_DEBUG_USAGE === '1' || process.env.HF_DEBUG_TOKENS === '1'

interface SessionState {
  // Workspace-scoped session state
  sessionsByWorkspace: Record<string, Session[]>
  currentIdByWorkspace: Record<string, string | null>

  // Activity State
  activityByRequestId: Record<string, ActivityEvent[]>

  // In-flight token usage during streaming (cumulative per node execution)
  inFlightUsageByKey: Record<
    string,
    { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }
  >
}

export class SessionService extends Service<SessionState> {
  constructor() {
    super({
      sessionsByWorkspace: {},
      currentIdByWorkspace: {},
      activityByRequestId: {},
      inFlightUsageByKey: {},
    })
  }

  protected onStateChange(updates: Partial<SessionState>): void {
    // Session state is persisted via sessionSaver, not via PersistenceManager

    // Emit events when sessions are updated (for usage/costs changes)
    if (updates.sessionsByWorkspace !== undefined) {
      // Find which workspace was updated
      for (const workspaceId in updates.sessionsByWorkspace) {
        const sessions = updates.sessionsByWorkspace[workspaceId]
        if (sessions) {
          this.events.emit('sessions:updated', { workspaceId, sessions })
        }
      }
    }

    // Emit events when current session changes
    if (updates.currentIdByWorkspace !== undefined) {
      for (const workspaceId in updates.currentIdByWorkspace) {
        const sessionId = updates.currentIdByWorkspace[workspaceId]
        if (sessionId) {
          this.events.emit('currentSession:changed', { workspaceId, sessionId })
        }
      }
    }
  }

  // ============================================================================
  // Getters
  // ============================================================================

  getSessionsFor(params: { workspaceId: string }): Session[] {
    const { workspaceId } = params
    return this.state.sessionsByWorkspace[workspaceId] || []
  }

  getCurrentIdFor(params: { workspaceId: string }): string | null {
    const { workspaceId } = params
    return this.state.currentIdByWorkspace[workspaceId] ?? null
  }

  getCurrentId(): string | null {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return null
    return this.getCurrentIdFor({ workspaceId: ws })
  }

  getCurrentSession(): Session | null {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return null
    const id = this.getCurrentIdFor({ workspaceId: ws })
    if (!id) return null
    const sessions = this.getSessionsFor({ workspaceId: ws })
    return sessions.find((s) => s.id === id) || null
  }

  getActivityForRequest(requestId: string): ActivityEvent[] {
    return this.state.activityByRequestId[requestId] || []
  }

  // ============================================================================
  // Setters (internal - used by this service and child services)
  // ============================================================================

  setSessionsFor(params: { workspaceId: string; sessions: Session[] }): void {
    const { workspaceId, sessions } = params
    this.setState({
      sessionsByWorkspace: {
        ...this.state.sessionsByWorkspace,
        [workspaceId]: sessions,
      },
    })
  }

  private setCurrentIdFor(params: { workspaceId: string; id: string | null }): void {
    const { workspaceId, id } = params
    this.setState({
      currentIdByWorkspace: {
        ...this.state.currentIdByWorkspace,
        [workspaceId]: id,
      },
    })
  }

  // ============================================================================
  // Session Loading
  // ============================================================================

  /**
   * Load sessions from disk for a workspace
   */
  async loadSessionsFor(params: { workspaceId: string }): Promise<void> {
    const { workspaceId } = params
    console.log('[Session] Loading sessions for workspace:', workspaceId)

    try {
      const sessions = await loadAllSessions(workspaceId)
      this.setSessionsFor({ workspaceId, sessions })
      console.log('[Session] Loaded sessions:', sessions.length)
    } catch (error) {
      console.error('[Session] Failed to load sessions:', error)
      this.setSessionsFor({ workspaceId, sessions: [] })
    }
  }

  /**
   * Load sessions for current workspace
   */
  async loadSessions(): Promise<void> {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) {
      console.warn('[Session] No workspace root, cannot load sessions')
      return
    }
    await this.loadSessionsFor({ workspaceId: ws })
  }

  // ============================================================================
  // Session Creation
  // ============================================================================

  /**
   * Ensure at least one session exists for a workspace
   */
  ensureSessionPresentFor(params: { workspaceId: string }): boolean {
    const { workspaceId } = params
    const sessions = this.getSessionsFor({ workspaceId })
    if (sessions.length > 0) return false

    // Create initial session
    this.newSessionFor({ workspaceId, title: initialSessionTitle() })
    return true
  }

  /**
   * Ensure at least one session exists for current workspace
   */
  ensureSessionPresent(): boolean {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return false
    return this.ensureSessionPresentFor({ workspaceId: ws })
  }

  /**
   * Create a new session for a workspace
   */
  newSessionFor(params: { workspaceId: string; title?: string }): string {
    const { workspaceId, title } = params
    const sessions = this.getSessionsFor({ workspaceId })

    // Get default provider/model from ProviderService
    const providerService = ServiceRegistry.get<any>('provider')
    const defaultProvider = providerService?.getSelectedProvider() || 'openai'
    const defaultModel = providerService?.getSelectedModel() || 'gpt-4o'

    // Generate new session
    const newSession: Session = {
      id: crypto.randomUUID(),
      title: title || initialSessionTitle(),
      timeline: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      currentContext: {
        contextId: crypto.randomUUID(),
        provider: defaultProvider,
        model: defaultModel,
        messageHistory: [],
      },
      totalTokenUsage: {},
      totalCost: {},
    }

    // Limit to MAX_SESSIONS
    const updated = [newSession, ...sessions].slice(0, MAX_SESSIONS)
    this.setSessionsFor({ workspaceId, sessions: updated })
    this.setCurrentIdFor({ workspaceId, id: newSession.id })

    // Emit event for other services to react
    this.emit('session:created', { workspaceId, sessionId: newSession.id })

    // Persist
    this.saveCurrentSession(true) // Immediate

    return newSession.id
  }

  /**
   * Create a new session for current workspace
   */
  newSession(title?: string): string {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) throw new Error('No workspace root')
    return this.newSessionFor({ workspaceId: ws, title })
  }

  // ============================================================================
  // Session Selection
  // ============================================================================

  /**
   * Select a session for a workspace
   */
  async selectFor(params: { workspaceId: string; id: string }): Promise<void> {
    const { workspaceId, id } = params
    const sessions = this.getSessionsFor({ workspaceId })
    const session = sessions.find((s) => s.id === id)
    if (!session) {
      console.warn('[Session] Session not found:', id)
      return
    }

    const previousId = this.getCurrentIdFor({ workspaceId })
    this.setCurrentIdFor({ workspaceId, id })

    // Update last activity
    const updated = sessions.map((s) => (s.id === id ? { ...s, lastActivityAt: Date.now() } : s))
    this.setSessionsFor({ workspaceId, sessions: updated })

    // Emit event for other services to react
    this.emit('session:selected', { workspaceId, sessionId: id, previousSessionId: previousId })

    // Persist
    await this.saveCurrentSession(true) // Immediate
  }

  /**
   * Select a session for current workspace
   */
  async select(id: string): Promise<void> {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) throw new Error('No workspace root')
    await this.selectFor({ workspaceId: ws, id })
  }

  // ============================================================================
  // Session Modification
  // ============================================================================

  /**
   * Rename a session
   */
  rename(params: { id: string; title: string }): void {
    const { id, title } = params
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const sessions = this.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s) =>
      s.id === id
        ? {
            ...s,
            title,
            updatedAt: Date.now(),
          }
        : s
    )

    this.setSessionsFor({ workspaceId: ws, sessions: updated })
    this.saveCurrentSession() // Debounced
  }

  /**
   * Delete a session
   */
  async remove(id: string): Promise<void> {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const sessions = this.getSessionsFor({ workspaceId: ws })
    const updated = sessions.filter((s) => s.id !== id)
    this.setSessionsFor({ workspaceId: ws, sessions: updated })

    // If we deleted the current session, select the first one
    const currentId = this.getCurrentIdFor({ workspaceId: ws })
    if (currentId === id) {
      const nextId = updated[0]?.id || null
      this.setCurrentIdFor({ workspaceId: ws, id: nextId })
    }

    // Emit event for other services to react (e.g., TerminalService to cleanup PTY)
    this.emit('session:deleted', { workspaceId: ws, sessionId: id })

    // Delete from disk
    try {
      await deleteSessionFromDisk(ws, id)
    } catch (error) {
      console.error('[Session] Failed to delete session from disk:', error)
    }

    // Persist
    await this.saveCurrentSession(true) // Immediate
  }

  // ============================================================================
  // Session Persistence
  // ============================================================================

  /**
   * Save current session to disk
   */
  async saveCurrentSession(immediate = false): Promise<void> {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const session = this.getCurrentSession()
    if (!session) return

    if (immediate) {
      await sessionSaver.save(ws, session)
    } else {
      sessionSaver.save(ws, session) // Debounced
    }
  }

  // ============================================================================
  // Flow Management
  // ============================================================================

  /**
   * Update session's last used flow
   */
  async updateCurrentSessionFlow(flowId: string): Promise<void> {
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const session = this.getCurrentSession()
    if (!session) return

    const sessions = this.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s) =>
      s.id === session.id ? { ...s, lastUsedFlow: flowId, updatedAt: Date.now() } : s
    )

    this.setSessionsFor({ workspaceId: ws, sessions: updated })
    await this.saveCurrentSession(true)
  }

  /**
   * Set executed flow for a session
   */
  async setSessionExecutedFlow(params: { sessionId: string; flowId: string }): Promise<void> {
    const { sessionId, flowId } = params
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const sessions = this.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, executedFlow: flowId, updatedAt: Date.now() } : s
    )

    this.setSessionsFor({ workspaceId: ws, sessions: updated })

    // Save if this is the current session
    const currentId = this.getCurrentIdFor({ workspaceId: ws })
    if (currentId === sessionId) {
      await this.saveCurrentSession(true)
    }
  }

  /**
   * Set provider/model for a session
   */
  async setSessionProviderModel(params: {
    sessionId: string
    provider: string
    model: string
  }): Promise<void> {
    const { sessionId, provider, model } = params
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) return

    const sessions = this.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            currentContext: {
              ...s.currentContext,
              provider,
              model,
            },
            updatedAt: Date.now(),
          }
        : s
    )

    this.setSessionsFor({ workspaceId: ws, sessions: updated })

    // Save if this is the current session
    const currentId = this.getCurrentIdFor({ workspaceId: ws })
    if (currentId === sessionId) {
      await this.saveCurrentSession(true)
    }
  }

  // ============================================================================
  // Token Usage Tracking
  // ============================================================================

  /**
   * Record token usage during streaming (cumulative)
   * All providers report cumulative usage per-step, so we calculate deltas
   */
  recordTokenUsage(params: {
    sessionId?: string
    requestId: string
    nodeId: string
    executionId: string
    provider: string
    model: string
    usage: TokenUsage
  }): void {
    const { sessionId, requestId, nodeId, executionId, provider, model, usage } = params

    const key = `${requestId}:${nodeId}:${executionId}`
    const prev = this.state.inFlightUsageByKey[key]?.usage || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    }

    // All providers report CUMULATIVE usage per-step
    // Calculate delta by subtracting previous from current
    const delta: TokenUsage = {
      inputTokens: Math.max(0, (usage.inputTokens || 0) - (prev.inputTokens || 0)),
      outputTokens: Math.max(0, (usage.outputTokens || 0) - (prev.outputTokens || 0)),
      totalTokens: Math.max(0, (usage.totalTokens || 0) - (prev.totalTokens || 0)),
      cachedTokens: Math.max(0, (usage.cachedTokens || 0) - (prev.cachedTokens || 0)),
    }

    const cumUsage: TokenUsage = {
      inputTokens: (prev.inputTokens || 0) + (delta.inputTokens || 0),
      outputTokens: (prev.outputTokens || 0) + (delta.outputTokens || 0),
      totalTokens: (prev.totalTokens || 0) + (delta.totalTokens || 0),
      cachedTokens: (prev.cachedTokens || 0) + (delta.cachedTokens || 0),
    }

    // Calculate cost
    const settingsService = ServiceRegistry.get<any>('settings')
    const cost = settingsService?.calculateCost(provider, model, cumUsage) || null

    if (DEBUG_USAGE) {
      console.log('[usage:recordTokenUsage]', {
        requestId,
        nodeId,
        executionId,
        provider,
        model,
        received: usage,
        delta,
        cumulative: cumUsage,
        cost,
      })
    }

    // Update in-flight usage
    this.setState({
      inFlightUsageByKey: {
        ...this.state.inFlightUsageByKey,
        [key]: { requestId, nodeId, executionId, provider, model, usage: cumUsage },
      },
    })

    // Trigger session save
    this.saveCurrentSession()
  }

  /**
   * Finalize node usage - add to session totals and remove from in-flight
   */
  finalizeNodeUsage(params: {
    sessionId?: string
    requestId: string
    nodeId: string
    executionId: string
  }): void {
    const { sessionId, requestId, nodeId, executionId } = params

    const key = `${requestId}:${nodeId}:${executionId}`
    const acc = this.state.inFlightUsageByKey[key]
    if (!acc) return

    const workspaceService = ServiceRegistry.get<any>('workspace')
    const ws = workspaceService?.getWorkspaceRoot()
    if (!ws) {
      // Remove from in-flight
      const { [key]: _, ...rest } = this.state.inFlightUsageByKey
      this.setState({ inFlightUsageByKey: rest })
      return
    }

    const sid = sessionId || this.getCurrentIdFor({ workspaceId: ws })
    if (!sid) {
      // Remove from in-flight
      const { [key]: _, ...rest } = this.state.inFlightUsageByKey
      this.setState({ inFlightUsageByKey: rest })
      return
    }

    const { provider, model, usage } = acc

    // Calculate cost
    const settingsService = ServiceRegistry.get<any>('settings')
    const cost = settingsService?.calculateCost(provider, model, usage) || null

    if (DEBUG_USAGE) {
      console.log('[usage:finalizeNodeUsage]', {
        requestId,
        nodeId,
        executionId,
        provider,
        model,
        final: usage,
        cost,
      })
    }

    // Update session totals
    const sessions = this.getSessionsFor({ workspaceId: ws })
    const updated = sessions.map((sess: Session) => {
      if (sess.id !== sid) return sess

      // Update tokenUsage structure
      const byProvider = sess.tokenUsage?.byProvider || {}
      const byProviderAndModel = sess.tokenUsage?.byProviderAndModel || {}
      const total = sess.tokenUsage?.total || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }

      const providerUsage = byProvider[provider] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
      const newProviderUsage = {
        inputTokens: providerUsage.inputTokens + (usage.inputTokens || 0),
        outputTokens: providerUsage.outputTokens + (usage.outputTokens || 0),
        totalTokens: providerUsage.totalTokens + (usage.totalTokens || 0),
        cachedTokens: (providerUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
      }

      const providerModels = byProviderAndModel[provider] || {}
      const modelUsage = providerModels[model] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
      const newModelUsage = {
        inputTokens: modelUsage.inputTokens + (usage.inputTokens || 0),
        outputTokens: modelUsage.outputTokens + (usage.outputTokens || 0),
        totalTokens: modelUsage.totalTokens + (usage.totalTokens || 0),
        cachedTokens: (modelUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
      }

      const newTotal = {
        inputTokens: total.inputTokens + (usage.inputTokens || 0),
        outputTokens: total.outputTokens + (usage.outputTokens || 0),
        totalTokens: total.totalTokens + (usage.totalTokens || 0),
        cachedTokens: (total.cachedTokens || 0) + (usage.cachedTokens || 0),
      }


      // Update costs structure
      const costsByProviderAndModel = sess.costs?.byProviderAndModel || {}
      const providerCosts = costsByProviderAndModel[provider] || {}
      const modelCost = providerCosts[model] || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }
      const newModelCost = cost
        ? {
            inputCost: modelCost.inputCost + (cost.inputCost || 0),
            outputCost: modelCost.outputCost + (cost.outputCost || 0),
            totalCost: modelCost.totalCost + (cost.totalCost || 0),
            currency: 'USD' as const,
          }
        : modelCost

      const totalCost = (sess.costs?.totalCost || 0) + (cost?.totalCost || 0)

      // Add to requestsLog
      const requestsLog = sess.requestsLog || []
      const newRequestsLog = [
        ...requestsLog,
        {
          timestamp: Date.now(),
          requestId,
          nodeId,
          executionId,
          provider,
          model,
          usage,
          cost: cost || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' as const },
        },
      ]

      return {
        ...sess,
        tokenUsage: {
          byProvider: {
            ...byProvider,
            [provider]: newProviderUsage,
          },
          byProviderAndModel: {
            ...byProviderAndModel,
            [provider]: {
              ...providerModels,
              [model]: newModelUsage,
            },
          },
          total: newTotal,
        },
        costs: {
          byProviderAndModel: {
            ...costsByProviderAndModel,
            [provider]: {
              ...providerCosts,
              [model]: newModelCost,
            },
          },
          totalCost,
          currency: 'USD',
        },
        requestsLog: newRequestsLog,
        updatedAt: Date.now(),
      }
    })

    this.setSessionsFor({ workspaceId: ws, sessions: updated })

    // Remove from in-flight
    const { [key]: _, ...rest } = this.state.inFlightUsageByKey
    this.setState({ inFlightUsageByKey: rest })

    // Persist
    this.saveCurrentSession()
  }

  /**
   * Finalize all nodes in a request
   */
  finalizeRequestUsage(params: { sessionId?: string; requestId: string }): void {
    const { sessionId, requestId } = params

    if (DEBUG_USAGE) {
      console.log('[usage:finalizeRequestUsage]', { requestId })
    }

    // Find all in-flight usage for this request
    const toFinalize: Array<{ nodeId: string; executionId: string }> = []
    for (const [key, entry] of Object.entries(this.state.inFlightUsageByKey)) {
      if (entry.requestId === requestId) {
        const [, nodeId, executionId] = key.split(':')
        toFinalize.push({ nodeId, executionId })
      }
    }

    // Finalize each node
    for (const { nodeId, executionId } of toFinalize) {
      this.finalizeNodeUsage({ sessionId, requestId, nodeId, executionId })
    }
  }


}


