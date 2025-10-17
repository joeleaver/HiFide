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
import type { Session, TokenUsage, TokenCost, AgentMetrics, ActivityEvent, SessionItem, SessionMessage, SessionBadgeGroup, Badge } from '../types'
import { LS_KEYS, MAX_SESSIONS } from '../utils/constants'
import { deriveTitle } from '../utils/sessions'
import { loadAllSessions, sessionSaver, deleteSessionFromDisk } from '../utils/session-persistence'

// ============================================================================
// Types
// ============================================================================

export interface SessionSlice {
  // Session State
  sessions: Session[]
  currentId: string | null
  sessionsLoaded: boolean

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
  updateSessionItem: (params: { id: string; updates: Partial<SessionItem> }) => void
  appendToLastMessage: (content: string) => void  // For streaming chunks
  appendToLastMessageWithNodeId: (content: string, nodeId: string) => void  // For streaming chunks with nodeId

  // Context Management
  updateCurrentContext: (params: {
    provider?: string
    model?: string
    systemInstructions?: string
    temperature?: number
  }) => void

  // Badge Helper Actions
  addBadge: (params: {
    badge: Omit<Badge, 'id' | 'timestamp'>
    nodeId?: string
    nodeLabel?: string
    nodeKind?: string
    provider?: string
    model?: string
    cost?: TokenCost
  }) => void
  updateBadge: (params: { badgeId: string; updates: Partial<Badge> }) => void

  // Token Usage Actions
  recordTokenUsage: (params: { provider: string; model: string; usage: TokenUsage }) => void

  // Flow Debug Log Actions
  addFlowDebugLog: (log: Omit<NonNullable<Session['flowDebugLogs']>[number], 'timestamp'>) => void
  clearFlowDebugLogs: () => void

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

    console.log('[saveCurrentSession] Saving session:', {
      sessionId: current.id,
      itemCount: current.items.length,
      immediate,
    })

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
    const state = get() as any
    if (state.initializeSession) {
      setTimeout(() => {
        void state.initializeSession()
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

  appendToLastMessage: (content: string) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        // Find the last message item
        const items = [...sess.items]
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].type === 'message') {
            const msg = items[i] as SessionMessage
            items[i] = {
              ...msg,
              content: msg.content + content,
            }
            break
          }
        }

        return {
          ...sess,
          items,
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Debounced save after append
    get().saveCurrentSession()
  },

  appendToLastMessageWithNodeId: (content: string, nodeId: string) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        // Find the last message item with matching nodeId
        const items = [...sess.items]
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].type === 'message' && items[i].nodeId === nodeId) {
            const msg = items[i] as SessionMessage
            items[i] = {
              ...msg,
              content: msg.content + content,
            }
            break
          }
        }

        return {
          ...sess,
          items,
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Debounced save after append
    get().saveCurrentSession()
  },

  // Context Management
  updateCurrentContext: ({ provider, model, systemInstructions, temperature }: {
    provider?: string
    model?: string
    systemInstructions?: string
    temperature?: number
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
          },
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Debounced save after context update
    get().saveCurrentSession()
  },

  // Badge Helper Actions
  addBadge: ({ badge, nodeId, nodeLabel, nodeKind, provider, model, cost, badgeId }: {
    badge: Omit<Badge, 'id' | 'timestamp'>
    nodeId?: string
    nodeLabel?: string
    nodeKind?: string
    provider?: string
    model?: string
    cost?: TokenCost
    badgeId?: string  // Optional: use specific ID (e.g., tool callId) instead of generating UUID
  }) => {
    const now = Date.now()
    const finalBadgeId = badgeId || crypto.randomUUID()

    const fullBadge: Badge = {
      ...badge,
      id: finalBadgeId,
      timestamp: now,
      nodeId,
    }

    // Check if we should add to existing badge group or create new one
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        const items = [...sess.items]

        // Try to find the most recent badge group from the same node
        let addedToExisting = false
        if (nodeId) {
          for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i]
            if (item.type === 'badge-group' && item.nodeId === nodeId) {
              // Add to existing group
              items[i] = {
                ...item,
                badges: [...item.badges, fullBadge],
              }
              addedToExisting = true
              break
            }
            // Stop if we hit a message (don't group across messages)
            if (item.type === 'message') break
          }
        }

        // If not added to existing group, create new group
        if (!addedToExisting) {
          const newGroup: SessionBadgeGroup = {
            type: 'badge-group',
            id: crypto.randomUUID(),
            nodeId,
            nodeLabel,
            nodeKind,
            timestamp: now,
            badges: [fullBadge],
            provider,
            model,
            cost,
          }
          items.push(newGroup)
        }

        return {
          ...sess,
          items,
          updatedAt: now,
        }
      })

      return { sessions }
    })

    // Debounced save
    get().saveCurrentSession()
  },

  updateBadge: ({ badgeId, updates }: { badgeId: string; updates: Partial<Badge> }) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        return {
          ...sess,
          items: sess.items.map(item => {
            if (item.type === 'badge-group') {
              return {
                ...item,
                badges: item.badges.map(badge =>
                  badge.id === badgeId ? { ...badge, ...updates } : badge
                ),
              }
            }
            return item
          }),
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Debounced save
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
})

