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
import { getProviderService } from './index.js'

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
  async newSessionFor(params: {
    workspaceId: string
    title?: string
    initialContext?: Partial<Session['currentContext']>
    executedFlowId?: string
    lastUsedFlowId?: string
  }): Promise<string> {
    const { workspaceId, title, initialContext, executedFlowId, lastUsedFlowId } = params
    const sessions = this.getSessionsFor({ workspaceId })
    const currentId = this.getCurrentIdFor({ workspaceId })
    const referenceSession = currentId ? sessions.find((s) => s.id === currentId) : sessions[0]

    // Get default provider/model from ProviderService
    const providerService = getProviderService()
    const defaultProvider = providerService.getSelectedProvider() || 'openai'
    const defaultModel = providerService.getSelectedModel() || 'gpt-4o'

    const inheritedProvider = initialContext?.provider ?? referenceSession?.currentContext?.provider
    const inheritedModel = initialContext?.model ?? referenceSession?.currentContext?.model
    const inheritedSystemInstructions =
      initialContext?.systemInstructions ?? referenceSession?.currentContext?.systemInstructions
    const inheritedTemperature = initialContext?.temperature ?? referenceSession?.currentContext?.temperature
    const messageHistory = Array.isArray(initialContext?.messageHistory)
      ? initialContext.messageHistory.map((entry) => ({ ...entry }))
      : []

    const provider = inheritedProvider || defaultProvider
    const model = inheritedModel || defaultModel

    const inheritedIncludeThoughts = initialContext?.includeThoughts ?? referenceSession?.currentContext?.includeThoughts
    const includeThoughts = inheritedIncludeThoughts !== undefined ? inheritedIncludeThoughts : true
    const inheritedThinkingBudget = initialContext?.thinkingBudget ?? referenceSession?.currentContext?.thinkingBudget
    const thinkingBudget = inheritedThinkingBudget !== undefined
      ? inheritedThinkingBudget
      : (includeThoughts ? 2048 : undefined)

    const context: Session['currentContext'] = {
      provider,
      model,
      messageHistory,
      includeThoughts,
      ...(thinkingBudget !== undefined ? { thinkingBudget } : {}),
    }
    if (inheritedSystemInstructions !== undefined) context.systemInstructions = inheritedSystemInstructions
    if (inheritedTemperature !== undefined) context.temperature = inheritedTemperature

    const flowSeed = executedFlowId ?? referenceSession?.executedFlow ?? referenceSession?.lastUsedFlow
    const lastUsedFlowSeed = lastUsedFlowId ?? referenceSession?.lastUsedFlow ?? flowSeed

    // Generate new session
    const newSession: Session = {
      id: crypto.randomUUID(),
      title: title || initialSessionTitle(),
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      currentContext: context,
      tokenUsage: {
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
        byProvider: {},
        byProviderAndModel: {},
      },
      costs: {
        byProviderAndModel: {},
        totalCost: 0,
        currency: 'USD',
        cachedInputCostTotal: 0,
        normalInputCostTotal: 0,
        totalSavings: 0,
      },
      requestsLog: [],
    }
    if (flowSeed) newSession.executedFlow = flowSeed
    if (lastUsedFlowSeed) newSession.lastUsedFlow = lastUsedFlowSeed

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

    // console.log('[SessionService] saveSessionFor:', { sessionId, workspaceId, immediate, itemCount: session.items?.length })
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



}


