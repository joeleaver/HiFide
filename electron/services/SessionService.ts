/**
 * Session Service
 *
 * Manages chat session CRUD operations including:
 * - Session CRUD (create, read, update, delete)
 * - Token usage and cost tracking (in-flight and finalized)
 * - Session persistence
 * - Session context management (provider, model, message history)
 *
 * Delegates to specialized services for:
 * - FlowCacheService: Flow node cache
 *
 * Timeline items are managed by timeline-event-handler.ts in flow-engine.
 */

import { Service } from './base/Service.js'
import type { Session, ActivityEvent, TokenUsage } from '../store/types.js'
import { loadAllSessions, sessionSaver, deleteSessionFromDisk } from '../store/utils/session-persistence.js'
import { getProviderService, getSettingsService } from './index.js'

const DEBUG_USAGE = process.env.HF_DEBUG_USAGE === '1' || process.env.HF_DEBUG_TOKENS === '1'
const MAX_SESSIONS = 100

// Helper function to generate initial session title
function initialSessionTitle(): string {
  return `Session ${new Date().toLocaleString()}`
}

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



  // ============================================================================
  // Session Creation
  // ============================================================================

  /**
   * Ensure at least one session exists for a workspace
   */
  async ensureSessionPresentFor(params: { workspaceId: string }): Promise<boolean> {
    const { workspaceId } = params
    const sessions = this.getSessionsFor({ workspaceId })
    if (sessions.length > 0) return false

    // Create initial session
    await this.newSessionFor({ workspaceId, title: initialSessionTitle() })
    return true
  }



  /**
   * Create a new session for a workspace
   */
  async newSessionFor(params: { workspaceId: string; title?: string }): Promise<string> {
    const { workspaceId, title } = params
    const sessions = this.getSessionsFor({ workspaceId })

    // Get default provider/model from ProviderService
    const providerService = getProviderService()
    const defaultProvider = providerService.getSelectedProvider() || 'openai'
    const defaultModel = providerService.getSelectedModel() || 'gpt-4o'

    // Generate new session
    const newSession: Session = {
      id: crypto.randomUUID(),
      title: title || initialSessionTitle(),
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      currentContext: {
        provider: defaultProvider,
        model: defaultModel,
        messageHistory: [],
      },
      tokenUsage: {
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 },
        byProvider: {},
        byProviderAndModel: {},
      },
      costs: {
        byProviderAndModel: {},
        totalCost: 0,
        currency: 'USD',
      },
      requestsLog: [],
    }

    // Limit to MAX_SESSIONS
    const updated = [newSession, ...sessions].slice(0, MAX_SESSIONS)
    this.setSessionsFor({ workspaceId, sessions: updated })
    this.setCurrentIdFor({ workspaceId, id: newSession.id })

    // Emit event for other services to react
    this.emit('session:created', { workspaceId, sessionId: newSession.id })

    // Persist
    await this.saveSessionFor({ workspaceId, sessionId: newSession.id }, true) // Immediate

    return newSession.id
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
    await this.saveSessionFor({ workspaceId, sessionId: id }, true) // Immediate
  }

  /**
   * Select a session for current workspace
   */


  // ============================================================================
  // Session Modification
  // ============================================================================

  /**
   * Reset current session context (clear timeline and message history)
   */
  async resetCurrentContextFor(params: { workspaceId: string; sessionId: string }): Promise<void> {
    const { workspaceId, sessionId } = params

    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            timeline: [],
            currentContext: {
              ...s.currentContext,
              contextId: crypto.randomUUID(),
              messageHistory: [],
            },
            updatedAt: Date.now(),
          }
        : s
    )

    this.setSessionsFor({ workspaceId, sessions: updated })
    await this.saveSessionFor({ workspaceId, sessionId }, true) // Immediate
  }

  /**
   * Update session context (messageHistory, provider, model, systemInstructions)
   * This is the primary sync point between the scheduler's mainContext and the session's currentContext
   */
  updateContextFor(params: {
    workspaceId: string
    sessionId: string
    messageHistory: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string
      metadata?: {
        id: string
        pinned?: boolean
        priority?: number
      }
    }>
    provider?: string
    model?: string
    systemInstructions?: string
  }): void {
    const { workspaceId, sessionId, messageHistory, provider, model, systemInstructions } = params

    // Normalize messageHistory defensively before writing into session state
    const safeHistory = Array.isArray(messageHistory) ? messageHistory : []

    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            currentContext: {
              ...s.currentContext,
              messageHistory: safeHistory,
              ...(provider !== undefined ? { provider } : {}),
              ...(model !== undefined ? { model } : {}),
              ...(systemInstructions !== undefined ? { systemInstructions } : {}),
            },
            updatedAt: Date.now(),
          }
        : s
    )

    this.setSessionsFor({ workspaceId, sessions: updated })
    this.saveSessionFor({ workspaceId, sessionId }, false) // Debounced
  }

  /**
   * @deprecated Use updateContextFor instead
   */
  updateMessageHistoryFor(params: {
    workspaceId: string
    sessionId: string
    messageHistory: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string
      metadata?: {
        id: string
        pinned?: boolean
        priority?: number
      }
    }>
  }): void {
    this.updateContextFor(params)
  }

  /**
   * Rename a session
   */
  renameFor(params: { workspaceId: string; id: string; title: string }): void {
    const { workspaceId, id, title } = params

    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.map((s) =>
      s.id === id
        ? {
            ...s,
            title,
            updatedAt: Date.now(),
          }
        : s
    )

    this.setSessionsFor({ workspaceId, sessions: updated })
    this.saveSessionFor({ workspaceId, sessionId: id }) // Debounced
  }

  /**
   * Delete a session
   */
  async removeFor(params: { workspaceId: string; id: string }): Promise<void> {
    const { workspaceId, id } = params

    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.filter((s) => s.id !== id)
    this.setSessionsFor({ workspaceId, sessions: updated })

    // If we deleted the current session, select the first one
    const currentId = this.getCurrentIdFor({ workspaceId })
    if (currentId === id) {
      const nextId = updated[0]?.id || null
      this.setCurrentIdFor({ workspaceId, id: nextId })
    }

    // Emit event for other services to react (e.g., TerminalService to cleanup PTY)
    this.emit('session:deleted', { workspaceId, sessionId: id })

    // Delete from disk
    try {
      await deleteSessionFromDisk(id)
    } catch (error) {
      console.error('[Session] Failed to delete session from disk:', error)
    }

    // Persist
    const nextSessionId = updated[0]?.id
    if (nextSessionId) {
      await this.saveSessionFor({ workspaceId, sessionId: nextSessionId }, true) // Immediate
    }
  }

  // ============================================================================
  // Session Persistence
  // ============================================================================

  /**
   * Save a session to disk
   */
  async saveSessionFor(params: { workspaceId: string; sessionId: string }, immediate = false): Promise<void> {
    const { workspaceId, sessionId } = params

    const sessions = this.getSessionsFor({ workspaceId })
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) {
      console.warn('[SessionService] saveSessionFor: session not found:', sessionId)
      return
    }

    console.log('[SessionService] saveSessionFor:', { sessionId, workspaceId, immediate, itemCount: session.items?.length })
    if (immediate) {
      await sessionSaver.save(session, true, workspaceId)
    } else {
      sessionSaver.save(session, false, workspaceId) // Debounced
    }
  }

  // ============================================================================
  // Flow Management
  // ============================================================================

  /**
   * Update session's last used flow
   */
  async updateSessionFlowFor(params: { workspaceId: string; sessionId: string; flowId: string }): Promise<void> {
    const { workspaceId, sessionId, flowId } = params

    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, lastUsedFlow: flowId, updatedAt: Date.now() } : s
    )

    this.setSessionsFor({ workspaceId, sessions: updated })
    await this.saveSessionFor({ workspaceId, sessionId }, true)
  }

  /**
   * Set executed flow for a session (the flow being run by the scheduler)
   */
  async setSessionExecutedFlowFor(params: { workspaceId: string; sessionId: string; flowId: string }): Promise<void> {
    const { workspaceId, sessionId, flowId } = params

    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, executedFlow: flowId, updatedAt: Date.now() } : s
    )

    this.setSessionsFor({ workspaceId, sessions: updated })
    await this.saveSessionFor({ workspaceId, sessionId }, true)
  }

  /**
   * Set provider/model for a session
   */
  async setSessionProviderModelFor(params: {
    workspaceId: string
    sessionId: string
    provider: string
    model: string
  }): Promise<void> {
    const { workspaceId, sessionId, provider, model } = params

    const sessions = this.getSessionsFor({ workspaceId })
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

    this.setSessionsFor({ workspaceId, sessions: updated })
    await this.saveSessionFor({ workspaceId, sessionId }, true)
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
    const { requestId, nodeId, executionId, provider, model, usage } = params

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
    const settingsService = getSettingsService()
    const cost = settingsService.calculateCost(provider, model, cumUsage) || null

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

    // Note: No save here - in-flight usage is ephemeral and will be persisted when finalized
  }

  /**
   * Finalize node usage - add to session totals and remove from in-flight
   */
  async finalizeNodeUsageFor(params: {
    workspaceId: string
    sessionId: string
    requestId: string
    nodeId: string
    executionId: string
  }): Promise<void> {
    const { workspaceId, sessionId, requestId, nodeId, executionId } = params

    const key = `${requestId}:${nodeId}:${executionId}`
    const acc = this.state.inFlightUsageByKey[key]
    if (!acc) return

    const { provider, model, usage } = acc

    // Calculate cost
    const settingsService = getSettingsService()
    const cost = settingsService.calculateCost(provider, model, usage) || null

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
    const sessions = this.getSessionsFor({ workspaceId })
    const updated = sessions.map((sess: Session) => {
      if (sess.id !== sessionId) return sess

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

    this.setSessionsFor({ workspaceId, sessions: updated })

    // Remove from in-flight
    const { [key]: _, ...rest } = this.state.inFlightUsageByKey
    this.setState({ inFlightUsageByKey: rest })

    // Persist (debounced)
    await this.saveSessionFor({ workspaceId, sessionId }, false)
  }

}


