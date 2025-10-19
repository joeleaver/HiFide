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
import type { Session, TokenUsage, TokenCost, AgentMetrics, ActivityEvent, SessionItem, SessionMessage, Badge } from '../types'
import { LS_KEYS, MAX_SESSIONS } from '../utils/constants'
import { deriveTitle } from '../utils/sessions'
import { loadAllSessions, sessionSaver, deleteSessionFromDisk } from '../utils/session-persistence'

// ============================================================================
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
  lastRequestTokenUsage: { provider: string; model: string; usage: TokenUsage; cost: TokenCost | null } | null
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
  recordTokenUsage: (params: { provider: string; model: string; usage: TokenUsage }) => void

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

  // LLM IPC Actions
  ensureLlmIpcSubscription: () => void
  ensureAgentMetricsSubscription: () => void
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

  lastRequestTokenUsage: null,
  lastRequestSavings: null,

  activityByRequestId: {},

  agentMetrics: null,

  // Session Actions
  loadSessions: async () => {
    let sessions = await loadAllSessions()

    // Get current session ID from localStorage (if in renderer) or use most recent
    let currentId: string | null = null
    if (typeof localStorage !== 'undefined') {
      currentId = localStorage.getItem(LS_KEYS.CURRENT_SESSION_ID)
    }

    // If no valid sessions found, create a new one automatically
    if (sessions.length === 0) {
      get().newSession()
      set({ sessionsLoaded: true })
      return
    }

    // If no current ID or session doesn't exist, use most recent
    if (!currentId || !sessions.find(s => s.id === currentId)) {
      currentId = sessions[0]?.id || null
    }

    set({ sessions, currentId, sessionsLoaded: true })
  },

  /**
   * Initialize the current session
   * - Loads the flow template (lastUsedFlow or default)
   * - Sets feSelectedTemplate to match the session's flow
   * - feLoadTemplate handles initialization or resumption based on flowState
   */
  initializeSession: async () => {
    const state = get() as any
    const currentSession = state.sessions?.find((s: Session) => s.id === state.currentId)

    if (!currentSession) {
      return
    }


    // Load the flow template (it will handle init/resume based on flowState)
    const flowTemplateId = currentSession.lastUsedFlow || 'default'

    // Set the selected template to match the session's flow (via any cast since it's in FlowEditorSlice)
    ;(set as any)({ feSelectedTemplate: flowTemplateId })

    if (state.feLoadTemplate) {
      await state.feLoadTemplate(flowTemplateId)
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
      try {
        localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, id)
      } catch {}
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

    // Update localStorage with current session ID (if in renderer)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, current.id)
    }
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, id)
    }

    // Initialize the selected session (loads flow and resumes if paused)
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

    const session: Session = {
      id: crypto.randomUUID(),
      title,
      items: [],  // Chronological timeline of messages and badge groups
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      currentContext: {
        provider,
        model,
      },
      flowDebugLogs: [],  // Initialize empty flow debug logs
      tokenUsage: {
        byProvider: {},
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      costs: {
        byProviderAndModel: {},
        totalCost: 0,
        currency: 'USD',
      },
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

    // Initialize the new session (loads flow and starts execution)
    const initializeSession = state.initializeSession
    if (initializeSession) {
      setTimeout(() => {
        void initializeSession()
      }, 100)
    }

    // Save the new session immediately (bypass debounce)
    get().saveCurrentSession(true)

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, session.id)
    }

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

    // For messages, automatically populate provider/model from current context
    let fullItem: SessionItem
    if (item.type === 'message') {
      const state = get()
      const currentSession = state.sessions.find(s => s.id === state.currentId)
      const context = currentSession?.currentContext

      fullItem = {
        ...item,
        id,
        timestamp: now,
        provider: context?.provider,
        model: context?.model,
      } as SessionMessage
    } else {
      fullItem = {
        ...item,
        id,
        timestamp: now,
      } as SessionItem
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
  recordTokenUsage: ({ provider, model, usage }: { provider: string; model: string; usage: TokenUsage }) => {
    // Calculate cost for this usage (from settings slice)
    const state = get() as any
    const cost = state.calculateCost ? state.calculateCost(provider, model, usage) : null

    set((s) => {
      if (!s.currentId) {
        return { lastRequestTokenUsage: { provider, model, usage, cost } }
      }

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        // Update provider-specific usage
        const providerUsage = sess.tokenUsage.byProvider[provider] || {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
        }

        const newProviderUsage = {
          inputTokens: providerUsage.inputTokens + usage.inputTokens,
          outputTokens: providerUsage.outputTokens + usage.outputTokens,
          totalTokens: providerUsage.totalTokens + usage.totalTokens,
          cachedTokens: (providerUsage.cachedTokens || 0) + (usage.cachedTokens || 0),
        }

        // Update total usage
        const newTotal = {
          inputTokens: sess.tokenUsage.total.inputTokens + usage.inputTokens,
          outputTokens: sess.tokenUsage.total.outputTokens + usage.outputTokens,
          totalTokens: sess.tokenUsage.total.totalTokens + usage.totalTokens,
          cachedTokens: (sess.tokenUsage.total.cachedTokens || 0) + (usage.cachedTokens || 0),
        }

        // Update costs
        const providerCosts = sess.costs.byProviderAndModel[provider] || {}
        const modelCost = providerCosts[model] || {
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          currency: 'USD',
        }

        const newModelCost = cost
          ? {
              inputCost: modelCost.inputCost + cost.inputCost,
              outputCost: modelCost.outputCost + cost.outputCost,
              totalCost: modelCost.totalCost + cost.totalCost,
              currency: 'USD',
            }
          : modelCost

        const newTotalCost = sess.costs.totalCost + (cost?.totalCost || 0)

        return {
          ...sess,
          tokenUsage: {
            byProvider: { ...sess.tokenUsage.byProvider, [provider]: newProviderUsage },
            total: newTotal,
          },
          costs: {
            byProviderAndModel: {
              ...sess.costs.byProviderAndModel,
              [provider]: {
                ...providerCosts,
                [model]: newModelCost,
              },
            },
            totalCost: newTotalCost,
            currency: 'USD',
          },
          updatedAt: Date.now(),
        }
      })

      return { sessions, lastRequestTokenUsage: { provider, model, usage, cost } }
    })

    // Save after recording token usage
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
      await window.ipcRenderer?.invoke('llm:cancel', { requestId: rid })
    } catch {}
    set({ currentRequestId: null })
  },

  // LLM IPC Actions
  ensureLlmIpcSubscription: () => {
    const state = get()
    if (state.llmIpcSubscribed) return

    const ipc = window.ipcRenderer
    if (!ipc) return

    // Chunk handler
    const onChunk = (_: any, payload: any) => {
      const { requestId, content } = payload || {}
      if (!requestId || requestId !== get().currentRequestId) return

      set((st) => ({
        streamingText: st.streamingText + (content || ''),
        chunkStats: {
          count: st.chunkStats.count + 1,
          totalChars: st.chunkStats.totalChars + (content?.length || 0),
        },
      }))
    }

    // Done handler
    const onDone = () => {
      const rid = get().currentRequestId
      if (!rid) return

      // Idempotency guard to avoid duplicate completion handling
      if (get().doneByRequestId?.[rid]) return
      set({ doneByRequestId: { ...get().doneByRequestId, [rid]: true } })

      const text = get().streamingText
      try {
        get().addSessionItem({
          type: 'message',
          role: 'assistant',
          content: text,
          nodeKind: 'llmRequest',  // Legacy LLM IPC path (should not be used with flows)
        } as any)
      } catch {}

      // Log chunk stats
      const cs = get().chunkStats
      const state = get() as any
      if (cs.count > 0 && state.addDebugLog) {
        state.addDebugLog('info', 'LLM', `Received ${cs.count} chunks (${cs.totalChars} chars total)`)
      }

      set({
        currentRequestId: null,
        streamingText: '',
        chunkStats: { count: 0, totalChars: 0 },
        retryCount: 0,
      })

      if (state.addDebugLog) {
        state.addDebugLog('info', 'LLM', 'Stream completed')
      }
    }

    // Error handler
    const onErr = async (_: any, payload: any) => {
      const rid = get().currentRequestId
      if (!rid) return

      // Get current session messages for retry
      const currentSession = get().sessions.find(s => s.id === get().currentId)
      const prev = currentSession?.items.filter(i => i.type === 'message').map((i: any) => ({
        role: i.role,
        content: i.content
      })) || []
      const cs = get().chunkStats

      set({
        currentRequestId: null,
        streamingText: '',
        chunkStats: { count: 0, totalChars: 0 },
      })

      const state = get() as any
      if (cs.count > 0 && state.addDebugLog) {
        state.addDebugLog('info', 'LLM', `Received ${cs.count} chunks (${cs.totalChars} chars total) before error`)
      }

      if (state.addDebugLog) {
        state.addDebugLog('error', 'LLM', `Error: ${payload?.error}`, { error: payload?.error })
      }

      // Auto-retry logic
      if (state.autoRetry && get().retryCount < 1) {
        const rid2 = crypto.randomUUID()

        set({ retryCount: get().retryCount + 1, currentRequestId: rid2 })

        if (state.addDebugLog) {
          state.addDebugLog('info', 'LLM', 'Auto-retrying request')
        }

        const res = await window.llm?.auto?.(rid2, prev, state.selectedModel, state.selectedProvider)

        try {
          if (state.pushRouteRecord) {
            state.pushRouteRecord({
              requestId: rid2,
              mode: (res as any)?.mode || 'chat',
              provider: state.selectedProvider,
              model: state.selectedModel,
              timestamp: Date.now(),
            })
          }
        } catch {}

        return
      }
    }

    // Token usage handler
    const onToken = (_: any, payload: any) => {
      const rid = get().currentRequestId
      if (!rid || payload?.requestId !== rid) return

      try {
        get().recordTokenUsage({ provider: payload.provider, model: payload.model, usage: payload.usage })
      } catch {}

      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog(
          'info',
          'Tokens',
          `Usage: ${payload.usage?.totalTokens} tokens (${payload.provider}/${payload.model})`,
          payload.usage
        )
      }
    }

    // Savings handler
    const onSavings = (_: any, payload: any) => {
      const rid = get().currentRequestId
      if (!rid || payload?.requestId !== rid) return

      set({
        lastRequestSavings: {
          provider: payload.provider,
          model: payload.model,
          approxTokensAvoided: Math.max(0, Number(payload?.approxTokensAvoided || 0)),
        },
      })
    }

    // Subscribe to all events
    ipc.on('llm:chunk', onChunk)
    ipc.on('llm:done', onDone)
    ipc.on('llm:error', onErr)
    ipc.on('llm:token-usage', onToken)
    ipc.on('llm:savings', onSavings)
    set({ llmIpcSubscribed: true })
  },

  ensureAgentMetricsSubscription: (() => {
    let subscribed = false
    return () => {
      if (subscribed) return
      subscribed = true

      try {
        window.ipcRenderer?.on('agent:metrics', (_: any, payload: any) => {
          set({ agentMetrics: payload })
        })
      } catch {}
    }
  })(),

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
        if (existingTimeout) clearTimeout(existingTimeout)
        flushTimeouts.set(nodeId, setTimeout(() => flush(nodeId), 100))
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
                ...updates
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

