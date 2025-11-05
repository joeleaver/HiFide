/**
 * Session Slice
 *
 * Manages chat sessions and LLM request lifecycle.
 *
 * Responsibilities:
 * - Chat sessions management (CRUD)
 * - Messages (user/assistant)
 * - Token usage tracking
 * - LLM request lifecycle
 * - Activity/badge state
 * - Session persistence
 *
 * Dependencies:
 * - Settings slice (for calculateCost)
 * - Terminal slice (for clearAgentTerminals)
 */

import type { StateCreator } from 'zustand'
import type { Session, TokenUsage, TokenCost, AgentMetrics, ActivityEvent, SessionItem, SessionMessage, NodeExecutionBox, Badge } from '../types'
import { MAX_SESSIONS } from '../utils/constants'
import { deriveTitle } from '../utils/sessions'
import { loadAllSessions, sessionSaver, deleteSessionFromDisk } from '../utils/session-persistence'

import { loadWorkspaceSettings, saveWorkspaceSettings } from '../../ipc/workspace'

// ============================================================================
const DEBUG_USAGE = process.env.HF_DEBUG_USAGE === '1' || process.env.HF_DEBUG_TOKENS === '1'

// Helper Functions
// ============================================================================



// ============================================================================
// Types
// ============================================================================

export interface SessionSlice {
  // Session State
  sessions: Session[]
  currentId: string | null
  sessionsLoaded: boolean

  // Current Node Execution State (simplified model)
  // Maps nodeId -> boxId for currently open boxes
  openExecutionBoxes: Record<string, string>

  // LLM Request State
  currentRequestId: string | null
  streamingText: string
  chunkStats: { count: number; totalChars: number }
  retryCount: number
  llmIpcSubscribed: boolean
  doneByRequestId: Record<string, boolean>

  // Token Usage State
  inFlightUsageByKey: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }>
  lastRequestTokenUsage: { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage; cost: TokenCost | null } | null
  lastRequestSavings: { provider: string; model: string; approxTokensAvoided: number } | null

  // Activity State
  activityByRequestId: Record<string, ActivityEvent[]>

  // Agent Metrics State
  agentMetrics: AgentMetrics | null

  // Session Actions
  loadSessions: () => Promise<void>
  initializeSession: () => Promise<void>
  ensureSessionPresent: () => boolean  // Returns true if a new session was created
  saveCurrentSession: (immediate?: boolean) => Promise<void>  // immediate bypasses debounce
  updateCurrentSessionFlow: (flowId: string) => Promise<void>
  select: (id: string) => void
  newSession: (title?: string) => string
  rename: (params: { id: string; title: string }) => void
  remove: (id: string) => Promise<void>

  // Session Item Actions
  addSessionItem: (item: Omit<SessionItem, 'id' | 'timestamp'>) => void

  // Node Execution Box Actions (simplified model)
  appendToNodeExecution: (params: {
    nodeId: string
    nodeLabel: string
    nodeKind: string
    content: { type: 'text'; text: string } | { type: 'badge'; badge: Badge }
    provider?: string
    model?: string
  }) => void
  updateBadgeInNodeExecution: (params: { nodeId: string; badgeId: string; updates: Partial<Badge> }) => void
  finalizeNodeExecution: (params: { nodeId: string; cost?: TokenCost }) => void

  // Context Management
  updateCurrentContext: (params: {
    provider?: string
    model?: string
    systemInstructions?: string
    temperature?: number
    messageHistory?: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string
      metadata?: {
        id: string
        pinned?: boolean
        priority?: number
      }
    }>
  }) => void



  // Token Usage Actions
  recordTokenUsage: (params: { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }) => void
  finalizeNodeUsage: (params: { requestId: string; nodeId: string; executionId: string }) => void
  finalizeRequestUsage: (params: { requestId: string }) => void

  // Flow Debug Log Actions
  addFlowDebugLog: (log: Omit<NonNullable<Session['flowDebugLogs']>[number], 'timestamp'>) => void
  clearFlowDebugLogs: () => void

  // Flow Cache Actions
  getNodeCache: (nodeId: string) => { data: any; timestamp: number } | undefined
  setNodeCache: (nodeId: string, cache: { data: any; timestamp: number }) => Promise<void>
  clearNodeCache: (nodeId: string) => Promise<void>

  // Activity Actions
  getActivityForRequest: (requestId: string) => ActivityEvent[]

  // LLM Request Actions (legacy - kept for stopCurrentRequest only)
  stopCurrentRequest: () => Promise<void>

  // LLM IPC Actions (no-op in main; events are handled directly by scheduler -> store)
  ensureLlmIpcSubscription: () => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set, get) => ({
  // State
  sessions: [],
  currentId: null,
  sessionsLoaded: false,

  currentRequestId: null,
  openExecutionBoxes: {},

  streamingText: '',
  chunkStats: { count: 0, totalChars: 0 },
  retryCount: 0,
  llmIpcSubscribed: false,
  doneByRequestId: {},

  inFlightUsageByKey: {},
  lastRequestTokenUsage: null,
  lastRequestSavings: null,

  activityByRequestId: {},

  agentMetrics: null,

  // Session Actions
  loadSessions: async () => {
    let sessions = await loadAllSessions()

    // Determine target currentId using workspace settings (lastSessionId) or persisted currentId
    let currentId: string | null = (get() as any).currentId || null

    // If no valid sessions found, create a new one automatically
    if (sessions.length === 0) {
      get().newSession()
      set({ sessionsLoaded: true })
      return
    }

    // Prefer workspace-scoped lastSessionId if available
    try {
      const settings = await loadWorkspaceSettings()
      const preferredId = (settings as any)?.lastSessionId
      if (preferredId && sessions.find(s => s.id === preferredId)) {
        currentId = preferredId
      }
    } catch (e) {
      console.error('[sessions] Failed to read workspace settings:', e)
    }

    // If no current ID or session doesn't exist in this workspace, use most recent
    if (!currentId || !sessions.find(s => s.id === currentId)) {
      currentId = sessions[0]?.id || null
    }

    set({ sessions, currentId, sessionsLoaded: true })
  },

  /**
   * Initialize the current session
   * - Loads the flow template (lastUsedFlow or default)
   * - Sets feSelectedTemplate to match the session's flow
   * - Does NOT start or resume the flow; leaves it in a stopped state
   * - Ensures a terminal exists for the session
   */
  initializeSession: async () => {
    const state = get() as any
    const currentSession = state.sessions?.find((s: Session) => s.id === state.currentId)

    if (!currentSession) {
      return
    }

    // Create the PTY session for this session (using session ID as PTY session ID)
    const workspaceRoot = state.workspaceRoot
    const getOrCreate = (globalThis as any).__getOrCreateAgentPtyFor
    if (getOrCreate) {
      console.log('[session] Creating PTY for session:', currentSession.id)
      await getOrCreate(currentSession.id, { cwd: workspaceRoot || undefined, sessionId: currentSession.id })
    }

    // Ensure terminal tab exists
    if (state.ensureSessionTerminal) {
      await state.ensureSessionTerminal()
    }

    // Load the flow template without starting execution
    const flowTemplateId = currentSession.lastUsedFlow || 'default'

    // Set the selected template to match the session's flow (via any cast since it's in FlowEditorSlice)
    ;(set as any)({ feSelectedTemplate: flowTemplateId })

    if (state.feLoadTemplate) {
      await state.feLoadTemplate({ templateId: flowTemplateId })
    }

    // Update session's lastUsedFlow if it wasn't set
    if (!currentSession.lastUsedFlow) {
      const sessions = state.sessions.map((s: Session) =>
        s.id === state.currentId
          ? { ...s, lastUsedFlow: flowTemplateId, updatedAt: Date.now() }
          : s
      )
      set({ sessions })
      if (state.saveCurrentSession) {
        await state.saveCurrentSession()
      }
    }

  },

  ensureSessionPresent: () => {
    const state = get()

    if (!state.sessions || state.sessions.length === 0) {
      get().newSession()
      return true // Created a new session
    }

    if (!state.currentId) {
      const id = state.sessions[0].id
      set({ currentId: id })
      return false // Selected existing session, needs initialization
    }

    return false // Session already present and selected
  },

  saveCurrentSession: async (immediate = false) => {
    const state = get()
    const current = state.sessions.find((sess) => sess.id === state.currentId)

    if (!current) {
      console.warn('[saveCurrentSession] No current session found')
      return
    }

    // Save to disk using debounced saver
    sessionSaver.save(current, immediate)

    // Persist handled by Zustand persist middleware in main process
  },

  updateCurrentSessionFlow: async (flowId: string) => {
    const state = get()
    if (!state.currentId) return


    const sessions = state.sessions.map((s: Session) =>
      s.id === state.currentId
        ? { ...s, lastUsedFlow: flowId, updatedAt: Date.now() }
        : s
    )

    set({ sessions })

    // Save the updated session
    await get().saveCurrentSession()
  },

  select: (id: string) => {
    // Save current session immediately before switching
    get().saveCurrentSession(true)

    set({ currentId: id })

    // Persist last selected session per workspace
    ;(async () => {
      try {
        const settings = await loadWorkspaceSettings()
        ;(settings as any).lastSessionId = id
        await saveWorkspaceSettings(settings)
      } catch (e) {
        console.error('[sessions] Failed to save lastSessionId:', e)
      }
    })()

    // Initialize the selected session (loads flow; does not start execution)
    const state = get()
    const stateAny = state as any
    if (stateAny.initializeSession) {
      setTimeout(() => {
        void stateAny.initializeSession()
      }, 100)
    }
  },

  newSession: (title = 'New Session') => {
    const now = Date.now()

    // Get current provider/model from store for initial context
    const state = get() as any
    const provider = state.selectedProvider || 'openai'
    const model = state.selectedModel || 'gpt-4o'

    // Get the currently selected flow template to use for this new session
    const lastUsedFlow = state.feSelectedTemplate || 'default'

    const session: Session = {
      id: crypto.randomUUID(),
      title,
      items: [],  // Chronological timeline of messages and badge groups
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lastUsedFlow,  // Set to currently selected flow
      currentContext: {
        provider,
        model,
      },
      flowDebugLogs: [],  // Initialize empty flow debug logs
      tokenUsage: {
        byProvider: {},
        byProviderAndModel: {},
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      costs: {
        byProviderAndModel: {},
        totalCost: 0,
        currency: 'USD',
      },
      requestsLog: [],
    }

    // Clear all agent terminals when creating a new session (from terminal slice)
    if (state.clearAgentTerminals) {
      void state.clearAgentTerminals()
    }

    // Clear global flow cache for new session (don't inherit cache from previous session)
    ;(globalThis as any).__hifideSessionFlowCache = {}

    set((s) => {
      const sessions = [session, ...s.sessions].slice(0, MAX_SESSIONS)
      return { sessions, currentId: session.id }
    })
    // Persist last selected session per workspace (new session)
    ;(async () => {
      try {
        const settings = await loadWorkspaceSettings()
        ;(settings as any).lastSessionId = session.id
        await saveWorkspaceSettings(settings)
      } catch (e) {
        console.error('[sessions] Failed to save lastSessionId (newSession):', e)
      }
    })()


    // Initialize the new session (loads flow; does not start execution)
    const initializeSession = state.initializeSession
    if (initializeSession) {
      setTimeout(() => {
        void initializeSession()
      }, 100)
    }

    // Save the new session immediately (bypass debounce)
    get().saveCurrentSession(true)


    return session.id
  },

  rename: ({ id, title }: { id: string; title: string }) => {
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === id ? { ...sess, title, updatedAt: Date.now() } : sess
      )
      return { sessions }
    })

    // Save the renamed session
    get().saveCurrentSession()
  },

  remove: async (id: string) => {
    set((s) => {
      const filtered = s.sessions.filter((sess) => sess.id !== id)
      const currentId = s.currentId === id ? (filtered[0]?.id ?? null) : s.currentId
      return { sessions: filtered, currentId }
    })

    // Delete the session file from disk
    try {
      await deleteSessionFromDisk(id)
    } catch (e) {
      console.error('[session] Failed to delete session:', e)
    }
  },

  // Session Item Actions
  addSessionItem: (item: Omit<SessionItem, 'id' | 'timestamp'>) => {
    const now = Date.now()
    const id = crypto.randomUUID()

    // Debug logging
    console.log('[addSessionItem] Adding item:', {
      type: item.type,
      role: (item as any).role,
      contentLength: (item as any).content?.length || 0,
      currentId: get().currentId,
      sessionCount: get().sessions.length,
    })

    // Add id and timestamp to the item
    let fullItem: SessionItem
    if (item.type === 'message') {
      // TypeScript needs help understanding that item has 'role' and 'content' when type === 'message'
      const messageItem = item as Omit<SessionMessage, 'id' | 'timestamp'>
      fullItem = {
        ...messageItem,
        id,
        timestamp: now,
      }
    } else {
      // TypeScript needs help understanding that item has all NodeExecutionBox fields when type === 'node-execution'
      const nodeItem = item as Omit<NodeExecutionBox, 'id' | 'timestamp'>
      fullItem = {
        ...nodeItem,
        id,
        timestamp: now,
      }
    }

    set((s) => {
      if (!s.currentId) {
        console.warn('[addSessionItem] No currentId, skipping')
        return {}
      }

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        // Update title if this is the first user message
        let newTitle = sess.title
        if (item.type === 'message' && (item as any).role === 'user') {
          const hasMessages = sess.items.some(i => i.type === 'message')
          if (!hasMessages && (!sess.title || sess.title === 'New Session')) {
            newTitle = deriveTitle((item as any).content)
          }
        }

        return {
          ...sess,
          title: newTitle,
          items: [...sess.items, fullItem],
          lastActivityAt: now,
          updatedAt: now,
        }
      })

      console.log('[addSessionItem] Updated sessions, new item count:', sessions.find(s => s.id === get().currentId)?.items.length)
      return { sessions }
    })

    // Debounced save after adding item
    get().saveCurrentSession()
  },

  updateSessionItem: ({ id, updates }: { id: string; updates: Partial<SessionItem> }) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        return {
          ...sess,
          items: sess.items.map(item =>
            item.id === id ? { ...item, ...updates } as SessionItem : item
          ),
          updatedAt: Date.now(),
        }
      })

      return { sessions } as Partial<SessionSlice>
    })

    // Debounced save after update
    get().saveCurrentSession()
  },



  // Context Management
  updateCurrentContext: ({ provider, model, systemInstructions, temperature, messageHistory }: {
    provider?: string
    model?: string
    systemInstructions?: string
    temperature?: number
    messageHistory?: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string
      metadata?: {
        id: string
        pinned?: boolean
        priority?: number
      }
    }>
  }) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        return {
          ...sess,
          currentContext: {
            ...sess.currentContext,
            ...(provider !== undefined && { provider }),
            ...(model !== undefined && { model }),
            ...(systemInstructions !== undefined && { systemInstructions }),
            ...(temperature !== undefined && { temperature }),
            ...(messageHistory !== undefined && { messageHistory }),
          },
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Debounced save after context update
    get().saveCurrentSession()
  },



  // Token Usage Actions
  recordTokenUsage: ({ requestId, nodeId, executionId, provider, model, usage }: { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }) => {
    const state = get() as any

    set((s) => {
      const inFlight: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }> = (s as any).inFlightUsageByKey || {}
      const key = `${requestId}:${nodeId}:${executionId}`
      const prev = inFlight[key]?.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }

      // Safety net: providers report cumulative usage per-step (running total).
      // Determine cumulative by totalTokens only; input/output may be non-monotonic between steps.
      const currTotal = (usage.totalTokens ?? ((usage.inputTokens || 0) + (usage.outputTokens || 0)))
      const prevTotal = (prev.totalTokens ?? ((prev.inputTokens || 0) + (prev.outputTokens || 0)))
      const looksCumulative = currTotal >= prevTotal

      const delta: TokenUsage = looksCumulative
        ? (() => {
            const dTotal = Math.max(0, currTotal - prevTotal)
            const dIn = Math.max(0, (usage.inputTokens || 0) - (prev.inputTokens || 0))
            const dOut = Math.max(0, dTotal - dIn)
            return {
              inputTokens: dIn,
              outputTokens: dOut,
              totalTokens: Math.max(0, dIn + dOut),
              cachedTokens: Math.max(0, (usage.cachedTokens || 0) - (prev.cachedTokens || 0)),
            }
          })()
        : {
            inputTokens: Math.max(0, usage.inputTokens || 0),
            outputTokens: Math.max(0, usage.outputTokens || 0),
            totalTokens: Math.max(0, usage.totalTokens ?? ((usage.inputTokens || 0) + (usage.outputTokens || 0))),
            cachedTokens: Math.max(0, usage.cachedTokens || 0),
          }

      const cumUsage: TokenUsage = {
        inputTokens: (prev.inputTokens || 0) + (delta.inputTokens || 0),
        outputTokens: (prev.outputTokens || 0) + (delta.outputTokens || 0),
        totalTokens: (prev.totalTokens || 0) + (delta.totalTokens || 0),
        cachedTokens: (prev.cachedTokens || 0) + (delta.cachedTokens || 0),
      }

      const entry = { requestId, nodeId, executionId, provider, model, usage: cumUsage }
      const newMap = { ...inFlight, [key]: entry }
      const cost = state.calculateCost ? state.calculateCost(provider, model, cumUsage) : null

      if (DEBUG_USAGE) {
        try {
          console.log('[usage:recordTokenUsage]', {
            requestId,
            nodeId,
            executionId,
            provider,
            model,
            mode: looksCumulative ? 'snapshot->delta' : 'delta',
            received: usage,
            delta,
            cumulative: cumUsage,
            cost
          })
        } catch {}
      }

      return {
        inFlightUsageByKey: newMap,
        lastRequestTokenUsage: { requestId, nodeId, executionId, provider, model, usage: cumUsage, cost },
        currentRequestId: requestId,
      }
    })

    // Persist latest cumulative usage for UI; totals added on finalization
    get().saveCurrentSession()
  },

  finalizeNodeUsage: ({ requestId, nodeId, executionId }: { requestId: string; nodeId: string; executionId: string }) => {
    const state = get() as any

    set((s) => {
      const accMap: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }> = (s as any).inFlightUsageByKey || {}
      const key = `${requestId}:${nodeId}:${executionId}`
      const acc = accMap[key]
      if (!acc) return {}

      if (!s.currentId) {
        const { [key]: _, ...rest } = accMap
        return { inFlightUsageByKey: rest }
      }

      const { provider, model, usage } = acc
      const cost = state.calculateCost ? state.calculateCost(provider, model, usage) : null

      if (DEBUG_USAGE) {
        try {
          console.log('[usage:finalizeNodeUsage]', { requestId, nodeId, executionId, provider, model, final: usage, cost })
        } catch {}
      }

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        const providerUsage = sess.tokenUsage.byProvider[provider] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
        const newProviderUsage = {
          inputTokens: providerUsage.inputTokens + (usage.inputTokens || 0),
          outputTokens: providerUsage.outputTokens + (usage.outputTokens || 0),
          totalTokens: providerUsage.totalTokens + (usage.totalTokens || 0),
          cachedTokens: (providerUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
        }

        const newTotal = {
          inputTokens: sess.tokenUsage.total.inputTokens + (usage.inputTokens || 0),
          outputTokens: sess.tokenUsage.total.outputTokens + (usage.outputTokens || 0),
          totalTokens: sess.tokenUsage.total.totalTokens + (usage.totalTokens || 0),
          cachedTokens: (sess.tokenUsage.total.cachedTokens || 0) + (usage.cachedTokens || 0),
        }

        const prevByProvModel = (sess.tokenUsage as any).byProviderAndModel || {}
        const prevProvModels = prevByProvModel[provider] || {}
        const prevModelUsage = prevProvModels[model] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
        const newProviderModelUsage = {
          inputTokens: prevModelUsage.inputTokens + (usage.inputTokens || 0),
          outputTokens: prevModelUsage.outputTokens + (usage.outputTokens || 0),
          totalTokens: prevModelUsage.totalTokens + (usage.totalTokens || 0),
          cachedTokens: (prevModelUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
        }

        const providerCosts = sess.costs.byProviderAndModel[provider] || {}
        const modelCost = providerCosts[model] || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }
        const prevCached = (modelCost as any).cachedInputCost || 0
        const prevSavings = (modelCost as any).savings || 0
        const newModelCost = cost ? {
          inputCost: modelCost.inputCost + (cost.inputCost || 0),
          outputCost: modelCost.outputCost + (cost.outputCost || 0),
          totalCost: modelCost.totalCost + (cost.totalCost || 0),
          currency: 'USD',
          cachedInputCost: prevCached + (cost.cachedInputCost || 0),
          savings: prevSavings + (cost.savings || 0),
        } : modelCost
        const newTotalCost = sess.costs.totalCost + (cost?.totalCost || 0)

        const reqLog = sess.requestsLog || []
        const logEntry = {
          timestamp: Date.now(),
          requestId,
          nodeId,
          executionId,
          provider,
          model,
          usage,
          cost: cost || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }
        }

        return {
          ...sess,
          tokenUsage: {
            byProvider: { ...sess.tokenUsage.byProvider, [provider]: newProviderUsage },
            byProviderAndModel: {
              ...prevByProvModel,
              [provider]: { ...prevProvModels, [model]: newProviderModelUsage },
            },
            total: newTotal,
          },
          costs: {
            byProviderAndModel: {
              ...sess.costs.byProviderAndModel,
              [provider]: { ...providerCosts, [model]: newModelCost },
            },
            totalCost: newTotalCost,
            currency: 'USD',
          },
          requestsLog: [...reqLog, logEntry],
          updatedAt: Date.now(),
        }
      })

      const { [key]: _, ...rest } = accMap
      return { sessions, inFlightUsageByKey: rest }
    })

    get().saveCurrentSession()
  },

  finalizeRequestUsage: ({ requestId }: { requestId: string }) => {
    const state = get() as any

    set((s) => {
      const accMap: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }> = (s as any).inFlightUsageByKey || {}
      const prefix = `${requestId}:`
      const keys = Object.keys(accMap).filter(k => k.startsWith(prefix))
      if (!keys.length) return {}

      let sessions = s.sessions
      for (const key of keys) {
        const acc = accMap[key]
        if (!acc) continue
        if (!s.currentId) continue
        const { provider, model, usage } = acc
        const cost = state.calculateCost ? state.calculateCost(provider, model, usage) : null

        if (DEBUG_USAGE) {
          try { console.log('[usage:finalizeRequestUsage]', { requestId, key, provider, model, final: usage, cost }) } catch {}
        }

        sessions = sessions.map((sess) => {
          if (sess.id !== s.currentId) return sess

          const providerUsage = sess.tokenUsage.byProvider[provider] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
          const newProviderUsage = {
            inputTokens: providerUsage.inputTokens + (usage.inputTokens || 0),
            outputTokens: providerUsage.outputTokens + (usage.outputTokens || 0),
            totalTokens: providerUsage.totalTokens + (usage.totalTokens || 0),
            cachedTokens: (providerUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
          }

          const newTotal = {
            inputTokens: sess.tokenUsage.total.inputTokens + (usage.inputTokens || 0),
            outputTokens: sess.tokenUsage.total.outputTokens + (usage.outputTokens || 0),
            totalTokens: sess.tokenUsage.total.totalTokens + (usage.totalTokens || 0),
            cachedTokens: (sess.tokenUsage.total.cachedTokens || 0) + (usage.cachedTokens || 0),
          }

          const prevByProvModel = (sess.tokenUsage as any).byProviderAndModel || {}
          const prevProvModels = prevByProvModel[provider] || {}
          const prevModelUsage = prevProvModels[model] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
          const newProviderModelUsage = {
            inputTokens: prevModelUsage.inputTokens + (usage.inputTokens || 0),
            outputTokens: prevModelUsage.outputTokens + (usage.outputTokens || 0),
            totalTokens: prevModelUsage.totalTokens + (usage.totalTokens || 0),
            cachedTokens: (prevModelUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
          }

          const providerCosts = sess.costs.byProviderAndModel[provider] || {}
          const modelCost = providerCosts[model] || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }
          const prevCached = (modelCost as any).cachedInputCost || 0
          const prevSavings = (modelCost as any).savings || 0
          const newModelCost = cost ? {
            inputCost: modelCost.inputCost + (cost.inputCost || 0),
            outputCost: modelCost.outputCost + (cost.outputCost || 0),
            totalCost: modelCost.totalCost + (cost.totalCost || 0),
            currency: 'USD',
            cachedInputCost: prevCached + (cost.cachedInputCost || 0),
            savings: prevSavings + (cost.savings || 0),
          } : modelCost
          const newTotalCost = sess.costs.totalCost + (cost?.totalCost || 0)

          const reqLog = sess.requestsLog || []
          const logEntry = {
            timestamp: Date.now(),
            requestId,
            nodeId: acc.nodeId,
            executionId: acc.executionId,
            provider,
            model,
            usage,
            cost: cost || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }
          }

          return {
            ...sess,
            tokenUsage: {
              byProvider: { ...sess.tokenUsage.byProvider, [provider]: newProviderUsage },
              byProviderAndModel: { ...prevByProvModel, [provider]: { ...prevProvModels, [model]: newProviderModelUsage } },
              total: newTotal,
            },
            costs: {
              byProviderAndModel: { ...sess.costs.byProviderAndModel, [provider]: { ...providerCosts, [model]: newModelCost } },
              totalCost: newTotalCost,
              currency: 'USD',
            },
            requestsLog: [...reqLog, logEntry],
            updatedAt: Date.now(),
          }
        })
      }

      const rest = Object.fromEntries(Object.entries(accMap).filter(([k]) => !k.startsWith(prefix)))
      return { sessions, inFlightUsageByKey: rest }
    })

    get().saveCurrentSession()
  },

  // Flow Debug Log Actions
  addFlowDebugLog: (log) => {
    const currentId = get().currentId
    if (!currentId) return

    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== currentId) return sess

        const flowDebugLogs = sess.flowDebugLogs || []
        return {
          ...sess,
          flowDebugLogs: [
            ...flowDebugLogs,
            {
              ...log,
              timestamp: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Save after adding log
    get().saveCurrentSession()
  },

  clearFlowDebugLogs: () => {
    const currentId = get().currentId
    if (!currentId) return

    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== currentId) return sess

        return {
          ...sess,
          flowDebugLogs: [],
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Save after clearing logs
    get().saveCurrentSession()
  },

  // Flow Cache Actions
  getNodeCache: (nodeId: string) => {
    const currentId = get().currentId
    if (!currentId) return undefined

    const currentSession = get().sessions.find((s) => s.id === currentId)
    return currentSession?.flowCache?.[nodeId]
  },

  setNodeCache: async (nodeId: string, cache: { data: any; timestamp: number }) => {
    const currentId = get().currentId
    if (!currentId) return

    console.log('[session] Setting cache for node:', nodeId)

    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== currentId) return sess

        // Update the node's cache entry
        const flowCache = { ...sess.flowCache, [nodeId]: cache }

        return {
          ...sess,
          flowCache,
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Save after setting cache
    await get().saveCurrentSession() // debounced save
  },

  clearNodeCache: async (nodeId: string) => {
    const currentId = get().currentId
    if (!currentId) return

    console.log('[session] Clearing cache for node:', nodeId)

    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== currentId) return sess

        // Remove the node's cache entry
        const flowCache = { ...sess.flowCache }
        delete flowCache[nodeId]

        return {
          ...sess,
          flowCache,
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Save after clearing cache
    await get().saveCurrentSession(true) // immediate save
  },

  // Activity Actions
  getActivityForRequest: (requestId: string) => {
    const state = get()
    return (state.activityByRequestId[requestId] || []) as ActivityEvent[]
  },

  // LLM Request Actions (legacy - kept for stopCurrentRequest only)
  stopCurrentRequest: async () => {
    const rid = get().currentRequestId
    if (!rid) return
    try {
      // Route cancellation through Flow V2
      const stateAny = get() as any
      if (typeof stateAny.feStop === 'function') {
        await stateAny.feStop()
      }
    } catch {}
    set({ currentRequestId: null })
  },

  // LLM IPC Actions
  ensureLlmIpcSubscription: () => {
    // No-op in main process. Event subscriptions are renderer-managed and forwarded via dispatch.
    const state = get()
    if (!state.llmIpcSubscribed) {
      set({ llmIpcSubscribed: true })
      const anyState = get() as any
      anyState.addDebugLog?.('info', 'LLM', 'LLM event subscription handled in renderer')
    }
  },



  // ============================================================================
  // Node Execution Box Actions (Simplified Model)
  // ============================================================================

  /**
   * Append content to a node's execution box
   * Creates the box if it doesn't exist yet (first content from this node)
   * Debounced for text chunks to prevent UI freezing during streaming
   */
  appendToNodeExecution: (() => {
    // Buffer for accumulating text chunks per nodeId
    const textBuffers = new Map<string, string>()
    const badgeQueues = new Map<string, Array<{ type: 'badge'; badge: any }>>()
    const flushTimeouts = new Map<string, NodeJS.Timeout>()
    const nodeMetadata = new Map<string, { nodeLabel: string; nodeKind: string; provider?: string; model?: string }>()

    const flush = (nodeId: string) => {
      const textBuffer = textBuffers.get(nodeId) || ''
      const badgeQueue = badgeQueues.get(nodeId) || []

      const contentToAdd: Array<{ type: 'text'; text: string } | { type: 'badge'; badge: any }> = []

      // Add buffered text if any
      if (textBuffer) {
        contentToAdd.push({ type: 'text', text: textBuffer })
        textBuffers.delete(nodeId)
      }

      // Add queued badges
      if (badgeQueue.length > 0) {
        contentToAdd.push(...badgeQueue)
        badgeQueues.delete(nodeId)
      }

      if (contentToAdd.length === 0) return

      // Clear any pending timeout for this node
      const existingTimeout = flushTimeouts.get(nodeId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
        flushTimeouts.delete(nodeId)
      }

      // Apply all buffered content in a single state update
      set((s) => {
        if (!s.currentId) return {}

        // Find existing open box for this nodeId
        const openBoxId = s.openExecutionBoxes[nodeId]
        let newBoxId: string | null = null

        const sessions = s.sessions.map((sess) => {
          if (sess.id !== s.currentId) return sess

          const existingBoxIndex = openBoxId
            ? sess.items.findIndex(item => item.id === openBoxId)
            : -1

          if (existingBoxIndex !== -1) {
            // Box exists - append content
            const items = [...sess.items]
            const box = items[existingBoxIndex] as any
            items[existingBoxIndex] = {
              ...box,
              content: [...box.content, ...contentToAdd]
            }

            return {
              ...sess,
              items,
              updatedAt: Date.now()
            }
          } else {
            // First content from this node - create new box
            const metadata = nodeMetadata.get(nodeId)
            if (!metadata) return sess // Shouldn't happen

            newBoxId = `box-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            const newBox: any = {
              type: 'node-execution',
              id: newBoxId,
              nodeId,
              nodeLabel: metadata.nodeLabel,
              nodeKind: metadata.nodeKind,
              timestamp: Date.now(),
              content: contentToAdd,
              provider: metadata.provider,
              model: metadata.model
            }

            return {
              ...sess,
              items: [...sess.items, newBox],
              updatedAt: Date.now()
            }
          }
        })

        // Update open boxes map if we created a new box
        if (newBoxId) {
          return {
            sessions,
            openExecutionBoxes: {
              ...s.openExecutionBoxes,
              [nodeId]: newBoxId
            }
          }
        }

        return { sessions }
      })

      // Debounced save
      get().saveCurrentSession()
    }

    // Expose flush function for finalizeNodeExecution to use
    // Store it on the global state object (hacky but works with closure)
    const appendFn = ({ nodeId, nodeLabel, nodeKind, content, provider, model }: {
      nodeId: string
      nodeLabel: string
      nodeKind: string
      content: { type: 'text'; text: string } | { type: 'badge'; badge: any }
      provider?: string
      model?: string
    }) => {
      // Store/update metadata for this node (in case we need to create a box)
      // Always update to ensure we capture the latest provider/model for each execution
      const existingMetadata = nodeMetadata.get(nodeId)
      nodeMetadata.set(nodeId, {
        nodeLabel,
        nodeKind,
        // Use provided provider/model if available, otherwise keep existing
        provider: provider || existingMetadata?.provider,
        model: model || existingMetadata?.model
      })

      if (content.type === 'text') {
        // Accumulate text chunks in buffer
        const existing = textBuffers.get(nodeId) || ''
        textBuffers.set(nodeId, existing + content.text)

        // Debounce flush (100ms - fast enough for smooth streaming, slow enough to batch)
        const existingTimeout = flushTimeouts.get(nodeId)
        // Throttle: if a flush is already scheduled, don't reschedule on every chunk.
        // This ensures we flush at most every 100ms even under continuous streaming.
        if (!existingTimeout) {
          flushTimeouts.set(nodeId, setTimeout(() => flush(nodeId), 100))
        }
      } else {
        // Badges are added immediately (flush any pending text first)
        const textBuffer = textBuffers.get(nodeId)
        if (textBuffer) {
          flush(nodeId)
        }

        const queue = badgeQueues.get(nodeId) || []
        queue.push(content)
        badgeQueues.set(nodeId, queue)

        // Flush badges immediately
        const existingTimeout = flushTimeouts.get(nodeId)
        if (existingTimeout) clearTimeout(existingTimeout)
        flush(nodeId)
      }
    }

    // Expose internal functions for finalizeNodeExecution to use
    ;(appendFn as any).__flush = flush
    ;(appendFn as any).__clearMetadata = (nodeId: string) => {
      nodeMetadata.delete(nodeId)
    }

    return appendFn
  })(),

  /**
   * Update a badge within a node's execution box
   */
  updateBadgeInNodeExecution: ({ nodeId, badgeId, updates }: { nodeId: string; badgeId: string; updates: Partial<any> }) => {
    set((s) => {
      if (!s.currentId) return {}

      const openBoxId = s.openExecutionBoxes[nodeId]
      if (!openBoxId) return {} // No open box for this node

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        const boxIndex = sess.items.findIndex(item => item.id === openBoxId)
        if (boxIndex === -1) return sess

        const box = sess.items[boxIndex] as any
        if (box.type !== 'node-execution') return sess

        // Find and update the badge
        const updatedContent = box.content.map((item: any) => {
          if (item.type === 'badge' && item.badge.id === badgeId) {
            return {
              ...item,
              badge: {
                ...item.badge,
                ...updates,
                // Deep merge metadata to preserve existing fields
                metadata: updates.metadata
                  ? { ...(item.badge.metadata || {}), ...updates.metadata }
                  : item.badge.metadata
              }
            }
          }
          return item
        })

        const items = [...sess.items]
        items[boxIndex] = {
          ...box,
          content: updatedContent
        }

        return {
          ...sess,
          items,
          updatedAt: Date.now()
        }
      })

      return { sessions }
    })

    // Debounced save
    get().saveCurrentSession()
  },

  /**
   * Finalize a node's execution box (add cost, close the box)
   * Note: We close the box here so that the next execution of the same node creates a new box
   */
  finalizeNodeExecution: ({ nodeId, cost }: { nodeId: string; cost?: any }) => {
    // First, flush any pending text chunks for this node
    // This ensures all content is in the box before we finalize it
    const appendFn = get().appendToNodeExecution as any
    if (appendFn && appendFn.__flush) {
      appendFn.__flush(nodeId)
    }

    // Clear metadata for this node so next execution starts fresh with new provider/model
    if (appendFn && appendFn.__clearMetadata) {
      appendFn.__clearMetadata(nodeId)
    }

    set((s) => {
      if (!s.currentId) return {}

      const openBoxId = s.openExecutionBoxes[nodeId]
      if (!openBoxId) return {} // No box to finalize

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        const boxIndex = sess.items.findIndex(item => item.id === openBoxId)

        if (boxIndex !== -1 && cost) {
          const items = [...sess.items]
          const box = items[boxIndex] as any
          items[boxIndex] = {
            ...box,
            cost
          }

          return {
            ...sess,
            items,
            updatedAt: Date.now()
          }
        }

        return sess
      })

      // Remove from open boxes map so next execution creates a new box
      const newOpenBoxes = { ...s.openExecutionBoxes }
      delete newOpenBoxes[nodeId]

      return { sessions, openExecutionBoxes: newOpenBoxes }
    })

    // Immediate save on finalize
    get().saveCurrentSession(true)
  },
})

