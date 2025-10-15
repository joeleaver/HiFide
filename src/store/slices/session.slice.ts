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
import type { Session, ChatMessage, TokenUsage, AgentMetrics, ActivityEvent } from '../types'
import { LS_KEYS, MAX_SESSIONS } from '../utils/constants'
import { loadSessions, deriveTitle } from '../utils/sessions'

// ============================================================================
// Types
// ============================================================================

export interface SessionSlice {
  // Session State
  sessions: Session[]
  currentId: string | null
  sessionsLoaded: boolean

  // Chat Input State
  chatInput: string
  setChatInput: (input: string) => void

  // LLM Request State
  currentRequestId: string | null
  streamingText: string
  chunkStats: { count: number; totalChars: number }
  retryCount: number
  llmIpcSubscribed: boolean
  doneByRequestId: Record<string, boolean>

  // Token Usage State
  lastRequestTokenUsage: { provider: string; model: string; usage: TokenUsage } | null
  lastRequestSavings: { provider: string; model: string; approxTokensAvoided: number } | null

  // Activity State
  activityByRequestId: Record<string, ActivityEvent[]>

  // Agent Metrics State
  agentMetrics: AgentMetrics | null

  // Session Actions
  loadSessions: () => Promise<void>
  initializeSession: () => Promise<void>
  ensureSessionPresent: () => boolean  // Returns true if a new session was created
  saveCurrentSession: () => Promise<void>
  updateCurrentSessionFlow: (flowId: string) => Promise<void>
  select: (id: string) => void
  newSession: (title?: string) => string
  rename: (id: string, title: string) => void
  remove: (id: string) => Promise<void>

  // Message Actions
  addUserMessage: (content: string) => void
  addAssistantMessage: (content: string) => void
  getCurrentMessages: () => ChatMessage[]

  // Tool Call Actions (for current turn)
  currentTurnToolCalls: import('../types').ToolCall[]  // Tool calls for the current LLM turn
  addToolCall: (toolName: string) => void
  updateToolCall: (toolName: string, status: 'success' | 'error', error?: string) => void
  flushToolCallsToMessage: () => void  // Move current turn tool calls to the last assistant message

  // Intent Detection (for current turn)
  currentTurnIntent: string | null  // Detected intent for the current turn
  setCurrentTurnIntent: (intent: string) => void

  // Token Usage Actions
  recordTokenUsage: (provider: string, model: string, usage: TokenUsage) => void

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

  chatInput: '',
  setChatInput: (input: string) => set({ chatInput: input }),

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

  currentTurnToolCalls: [],
  currentTurnIntent: null,

  // Session Actions
  loadSessions: async () => {
    const { sessions, currentId } = await loadSessions()
    set({ sessions, currentId, sessionsLoaded: true })
    console.debug('[session] Loaded sessions:', sessions.length, 'current:', currentId)
  },

  /**
   * Initialize the current session
   * - Loads the flow template (lastUsedFlow or default)
   * - feLoadTemplate handles initialization or resumption based on flowState
   */
  initializeSession: async () => {
    const state = get() as any
    const currentSession = state.sessions?.find((s: Session) => s.id === state.currentId)

    if (!currentSession) {
      console.warn('[session] No current session to initialize')
      return
    }

    console.log('[session] Initializing session:', currentSession.id)

    // Load the flow template (it will handle init/resume based on flowState)
    const flowTemplateId = currentSession.lastUsedFlow || 'default'
    console.log('[session] Loading flow template:', flowTemplateId)

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

    console.log('[session] Session initialized')
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

  saveCurrentSession: async () => {
    const state = get()
    const current = state.sessions.find((sess) => sess.id === state.currentId)
    if (!current || !window.sessions) return

    try {
      await window.sessions.save(current)
      localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, current.id)
      console.debug('[session] Saved session:', current.id)
    } catch (e) {
      console.error('[session] Failed to save session:', e)
    }
  },

  updateCurrentSessionFlow: async (flowId: string) => {
    const state = get()
    if (!state.currentId) return

    console.log('[session] Updating current session flow to:', flowId)

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
    set({ currentId: id })
    localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, id)
    console.debug('[session] Selected session:', id)

    // Initialize the selected session (loads flow and resumes if paused)
    const state = get() as any
    if (state.initializeSession) {
      setTimeout(() => {
        void state.initializeSession()
      }, 100)
    }
  },

  newSession: (title = 'New Chat') => {
    const session: Session = {
      id: crypto.randomUUID(),
      title,
      messages: [],
      toolCalls: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
    const state = get() as any
    if (state.clearAgentTerminals) {
      void state.clearAgentTerminals()
    }

    set((s) => {
      const sessions = [session, ...s.sessions].slice(0, MAX_SESSIONS)
      return { sessions, currentId: session.id }
    })

    // Initialize the new session (loads flow and starts execution)
    const initializeSession = (state as any).initializeSession
    if (initializeSession) {
      console.log('[newSession] Initializing session for new conversation...')
      setTimeout(() => {
        void initializeSession()
      }, 100)
    }

    // Save the new session immediately
    if (window.sessions) {
      window.sessions.save(session).catch((e) => console.error('[session] Failed to save new session:', e))
    }

    localStorage.setItem(LS_KEYS.CURRENT_SESSION_ID, session.id)
    console.debug('[session] Created new session:', session.id)

    return session.id
  },

  rename: (id: string, title: string) => {
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === id ? { ...sess, title, updatedAt: Date.now() } : sess
      )
      return { sessions }
    })

    // Save the renamed session
    get().saveCurrentSession()
    console.debug('[session] Renamed session:', id, 'to:', title)
  },

  remove: async (id: string) => {
    set((s) => {
      const filtered = s.sessions.filter((sess) => sess.id !== id)
      const currentId = s.currentId === id ? (filtered[0]?.id ?? null) : s.currentId
      return { sessions: filtered, currentId }
    })

    // Delete the session file
    if (window.sessions) {
      try {
        await window.sessions.delete(id)
        console.debug('[session] Deleted session:', id)
      } catch (e) {
        console.error('[session] Failed to delete session:', e)
      }
    }
  },

  // Message Actions
  addUserMessage: (content: string) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        const isFirst = sess.messages.length === 0
        const newTitle = isFirst && (!sess.title || sess.title === 'New Chat') ? deriveTitle(content) : sess.title

        return {
          ...sess,
          title: newTitle,
          messages: [...sess.messages, { role: 'user' as const, content }],
          updatedAt: Date.now(),
        }
      })

      return { sessions }
    })

    // Save after user message
    get().saveCurrentSession()
  },

  addAssistantMessage: (content: string) => {
    set((s) => {
      if (!s.currentId) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        const last = sess.messages[sess.messages.length - 1]
        if (last && last.role === 'assistant' && last.content === content) {
          // Deduplicate identical consecutive assistant messages
          return sess
        }

        // Add assistant message with current turn's tool calls and intent
        return {
          ...sess,
          messages: [...sess.messages, {
            role: 'assistant' as const,
            content,
            toolCalls: s.currentTurnToolCalls.length > 0 ? [...s.currentTurnToolCalls] : undefined,
            intent: s.currentTurnIntent || undefined,
            tokenUsage: s.lastRequestTokenUsage?.usage || undefined,
          }],
          updatedAt: Date.now(),
        }
      })

      return { sessions, currentTurnToolCalls: [], currentTurnIntent: null }  // Clear tool calls and intent after adding to message
    })

    // Save after assistant message
    get().saveCurrentSession()
  },

  getCurrentMessages: () => {
    const state = get()
    const current = state.sessions.find((sess) => sess.id === state.currentId)
    return current?.messages ?? []
  },

  // Tool Call Actions - track tool calls for current turn
  addToolCall: (toolName: string) => {
    const toolCall: import('../types').ToolCall = {
      toolName,
      timestamp: Date.now(),
      status: 'running',
    }

    set((s) => ({
      currentTurnToolCalls: [...s.currentTurnToolCalls, toolCall]
    }))
  },

  updateToolCall: (toolName: string, status: 'success' | 'error', error?: string) => {
    set((s) => {
      // Find the most recent running tool call with this name
      const toolCalls = [...s.currentTurnToolCalls]
      for (let i = toolCalls.length - 1; i >= 0; i--) {
        if (toolCalls[i].toolName === toolName && toolCalls[i].status === 'running') {
          toolCalls[i] = {
            ...toolCalls[i],
            status,
            error,
          }
          break
        }
      }

      return { currentTurnToolCalls: toolCalls }
    })
  },

  flushToolCallsToMessage: () => {
    set((s) => {
      if (!s.currentId || s.currentTurnToolCalls.length === 0) return {}

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        // Find the last assistant message and attach tool calls to it
        const messages = [...sess.messages]
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            messages[i] = {
              ...messages[i],
              toolCalls: s.currentTurnToolCalls
            }
            break
          }
        }

        return {
          ...sess,
          messages,
          updatedAt: Date.now(),
        }
      })

      return { sessions, currentTurnToolCalls: [] }
    })

    // Save after flushing tool calls
    get().saveCurrentSession()
  },

  // Intent Detection Actions
  setCurrentTurnIntent: (intent: string) => {
    console.log('[session] Setting current turn intent:', intent)
    set({ currentTurnIntent: intent })
  },

  // Token Usage Actions
  recordTokenUsage: (provider: string, model: string, usage: TokenUsage) => {
    set((s) => {
      if (!s.currentId) {
        return { lastRequestTokenUsage: { provider, model, usage } }
      }

      // Calculate cost for this usage (from settings slice)
      const state = get() as any
      const cost = state.calculateCost ? state.calculateCost(provider, model, usage) : null

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

      return { sessions, lastRequestTokenUsage: { provider, model, usage } }
    })

    // Save after recording token usage
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
        get().addAssistantMessage(text)
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

      const prev = get().getCurrentMessages()
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
        get().recordTokenUsage(payload.provider, payload.model, payload.usage)
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
    console.debug('[session] LLM IPC subscription initialized')
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
        console.debug('[session] Agent metrics subscription initialized')
      } catch {}
    }
  })(),
})

