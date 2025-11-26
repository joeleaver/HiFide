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
import { deriveTitle, initialSessionTitle } from '../utils/sessions'
import { loadAllSessions, sessionSaver, deleteSessionFromDisk } from '../utils/session-persistence'

import { loadWorkspaceSettings, saveWorkspaceSettings } from '../../ipc/workspace'

import * as agentPty from '../../services/agentPty'

// ============================================================================
const DEBUG_USAGE = process.env.HF_DEBUG_USAGE === '1' || process.env.HF_DEBUG_TOKENS === '1'

// Helper Functions
// ============================================================================



// ============================================================================
// Types
// ============================================================================

export interface SessionSlice {

  // Workspace-scoped session state (Phase 3 migration)
  sessionsByWorkspace: Record<string, Session[]>
  currentIdByWorkspace: Record<string, string | null>

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
  setSessionExecutedFlow: (params: { sessionId: string; flowId: string }) => Promise<void>
  setSessionProviderModel: (params: { sessionId: string; provider: string; model: string }) => Promise<void>
  select: (id: string) => void
  newSession: (title?: string) => string
  rename: (params: { id: string; title: string }) => void
  remove: (id: string) => Promise<void>

  // Workspace-scoped helpers (Phase 3)
  getSessionsFor: (params: { workspaceId: string }) => Session[]
  setSessionsFor: (params: { workspaceId: string; sessions: Session[] }) => void
  getCurrentIdFor: (params: { workspaceId: string }) => string | null
  setCurrentIdFor: (params: { workspaceId: string; id: string | null }) => void

  // Workspace-scoped actions (Phase 2)
  selectFor: (params: { workspaceId: string; id: string }) => Promise<void>
  newSessionFor: (params: { workspaceId: string; title?: string }) => string
  loadSessionsFor: (params: { workspaceId: string }) => Promise<void>
  ensureSessionPresentFor: (params: { workspaceId: string }) => boolean
  initializeSessionFor: (params: { workspaceId: string }) => Promise<void>

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


  // Start a brand-new conversation context for the current session: clears timeline and resets messageHistory
  startNewContext: () => Promise<void>



  // Token Usage Actions
  recordTokenUsage: (params: { sessionId?: string; requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }) => void
  finalizeNodeUsage: (params: { sessionId?: string; requestId: string; nodeId: string; executionId: string }) => void
  finalizeRequestUsage: (params: { sessionId?: string; requestId: string }) => void

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
  // State (workspace-scoped only)
  sessionsByWorkspace: {},
  currentIdByWorkspace: {},

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


	  // Workspace-scoped helpers (Phase 3)
	  getSessionsFor: ({ workspaceId }: { workspaceId: string }) => {
	    const map = (get() as any).sessionsByWorkspace || {}
	    return map[workspaceId] || []
	  },
	  setSessionsFor: ({ workspaceId, sessions }: { workspaceId: string; sessions: Session[] }) => {
	    set((s: any) => ({
	      sessionsByWorkspace: {
	        ...(s.sessionsByWorkspace || {}),
	        [workspaceId]: sessions,
	      },
	    }))
	  },
	  getCurrentIdFor: ({ workspaceId }: { workspaceId: string }) => {
	    const map = (get() as any).currentIdByWorkspace || {}
	    return map[workspaceId] ?? null
	  },
	  setCurrentIdFor: ({ workspaceId, id }: { workspaceId: string; id: string | null }) => {
	    set((s: any) => ({
	      currentIdByWorkspace: {
	        ...(s.currentIdByWorkspace || {}),
	        [workspaceId]: id,
	      },
	    }))
	  },

		  // Workspace-scoped actions (Phase 2)
		  selectFor: async ({ workspaceId, id }: { workspaceId: string; id: string }) => {
		    const state: any = get()
		    const isActiveWorkspace = state.workspaceRoot === workspaceId

		    // Save current session immediately before switching (only for active workspace)
		    if (isActiveWorkspace && typeof state.saveCurrentSession === 'function') {
		      try { await state.saveCurrentSession(true) } catch {}
		    }
		    // Update workspace-scoped currentId (and mirror to global if active workspace)
		    set((s: any) => {
		      const next: any = {
		        currentIdByWorkspace: {
		          ...(s.currentIdByWorkspace || {}),
		          [workspaceId]: id,
		        },
		      }
		      if (isActiveWorkspace) {
        const list: any[] = (((s as any).sessionsByWorkspace || {})[workspaceId]) || []
        const sel = Array.isArray(list) ? list.find((x: any) => x.id === id) : null
        ;(next as any).feSelectedTemplate = sel?.lastUsedFlow || ((s as any).feSelectedTemplate)
        ;(next as any).feMainFlowContext = sel?.currentContext || null
        ;(next as any).feIsolatedContexts = {}


		      }
		      return next
		    })
		    // Persist last selected session for this workspace (only for active workspace)
		    if (isActiveWorkspace) {
		      ;(async () => {
		        try {
		          const settings = await loadWorkspaceSettings()
		          ;(settings as any).lastSessionId = id
		          await saveWorkspaceSettings(settings)
		        } catch (e) {
		          console.error('[sessions] Failed to save lastSessionId (selectFor):', e)
		        }
		      })()
		    }
		    // Initialize the selected session (loads flow and starts execution) for active workspace
		    if (isActiveWorkspace && typeof state.initializeSession === 'function') {
		      setTimeout(() => { void state.initializeSession() }, 100)
		    }
		  },

		  newSessionFor: ({ workspaceId, title }: { workspaceId: string; title?: string }) => {
		    const now = Date.now()
		    const state: any = get()
		    const isActiveWorkspace = state.workspaceRoot === workspaceId

		    const initialTitle = (typeof title === 'string' && title.trim().length > 0) ? title : initialSessionTitle(now)
		    const provider = state.selectedProvider || 'openai'
		    const model = state.selectedModel || 'gpt-4o'
		    const lastUsedFlow = state.feSelectedTemplate || 'default'
			    const prevList: Session[] = (typeof state.getSessionsFor === 'function')
			      ? (state.getSessionsFor({ workspaceId }) || [])
			      : []
			    const prevId: string | null = (typeof state.getCurrentIdFor === 'function')
			      ? (state.getCurrentIdFor({ workspaceId }) ?? null)
			      : null
			    const prevSession: Session | null = Array.isArray(prevList)
			      ? (prevList.find((s) => s.id === prevId) || null)
			      : null
			    const effectiveLastUsedFlow = prevSession?.lastUsedFlow || lastUsedFlow
			    const effectiveProvider = prevSession?.currentContext?.provider || provider
			    const effectiveModel = prevSession?.currentContext?.model || model

		    const session: Session = {
		      id: crypto.randomUUID(),
		      title: initialTitle,
		      items: [],
		      createdAt: now,
		      updatedAt: now,
		      lastActivityAt: now,
		      lastUsedFlow: effectiveLastUsedFlow,
		      currentContext: {
		        provider: effectiveProvider,
		        model: effectiveModel,
		        messageHistory: [] // Explicitly initialize empty messageHistory
		      },
		      flowDebugLogs: [],
		      tokenUsage: { byProvider: {}, byProviderAndModel: {}, total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
		      costs: { byProviderAndModel: {}, totalCost: 0, currency: 'USD' },
		      requestsLog: [],
		    }

		    // Active workspace side-effects
		    if (isActiveWorkspace) {
		      if (typeof state.clearAgentTerminals === 'function') {
		        try { void state.clearAgentTerminals() } catch {}
		      }
		      ;(globalThis as any).__hifideSessionFlowCache = {}
		    }
		    // Write into per-workspace maps and mirror to global if active workspace
		    set((s: any) => {
		      const prevList: Session[] = (s.sessionsByWorkspace?.[workspaceId] || [])
		      const newList = [session, ...prevList].slice(0, MAX_SESSIONS)
		      const patch: any = {
		        sessionsByWorkspace: {
		          ...(s.sessionsByWorkspace || {}),
		          [workspaceId]: newList,
		        },
		        currentIdByWorkspace: {
		          ...(s.currentIdByWorkspace || {}),



		          [workspaceId]: session.id,
		        },
		      }
		      if (isActiveWorkspace) {
        ;(patch as any).feSelectedTemplate = session.lastUsedFlow
        ;(patch as any).feMainFlowContext = session.currentContext
        ;(patch as any).feIsolatedContexts = {}



		      }
		      return patch
		    })
		    // Persist last selected session per workspace (only for active workspace)
		    if (isActiveWorkspace) {
		      ;(async () => {
		        try {
		          const settings = await loadWorkspaceSettings()
		          ;(settings as any).lastSessionId = session.id
		          await saveWorkspaceSettings(settings)
		        } catch (e) {
		          console.error('[sessions] Failed to save lastSessionId (newSessionFor):', e)
		        }
		      })()
		    }
		    // Initialize/save only for active workspace to preserve isolation
		    if (isActiveWorkspace && typeof state.initializeSession === 'function') {
		      setTimeout(() => { void state.initializeSession() }, 100)
		    }
		    if (isActiveWorkspace && typeof state.saveCurrentSession === 'function') {
		      // Fire off immediate save (don't await to keep function synchronous)
		      // The save will complete before app can restart due to immediate=true
		      void state.saveCurrentSession(true)

		    }
		    return session.id
		  },


		  // Workspace-scoped loaders/initializers (Phase 2)
		  loadSessionsFor: async ({ workspaceId }: { workspaceId: string }) => {
		    const state: any = get()
		    const isActive = state.workspaceRoot === workspaceId
		    // Load from disk for the active workspace (loadAllSessions reads from current workspaceRoot)
		    const sessions = await loadAllSessions(workspaceId)
		    let currentId: string | null = (typeof state.getCurrentIdFor === 'function') ? state.getCurrentIdFor({ workspaceId }) : null
		    if (sessions.length === 0) {
		      // If no sessions on disk, create one via newSessionFor; that will set maps and (if active) mirror globals
		      get().newSessionFor({ workspaceId })
		      return
		    }
		    // Prefer workspace settings lastSessionId only for active workspace
		    if (isActive) {
		      try {
		        const settings = await loadWorkspaceSettings()
		        const preferredId = (settings as any)?.lastSessionId
		        if (preferredId && sessions.find(s => s.id === preferredId)) {
		          currentId = preferredId
		        }
		      } catch (e) {
		        console.error('[sessions] Failed to read workspace settings (loadSessionsFor):', e)
		      }
		    }


		    // If no current ID or not found, use most recent
		    if (!currentId || !sessions.find(s => s.id === currentId)) {
		      currentId = sessions[0]?.id || null
		    }
		    // Write into per-workspace maps and (if active) mirror global + sessionsLoaded
		    set((s: any) => {
		      const patch: any = {
		        sessionsByWorkspace: { ...(s.sessionsByWorkspace || {}), [workspaceId]: sessions },
		        currentIdByWorkspace: { ...(s.currentIdByWorkspace || {}), [workspaceId]: currentId },
		      }
		      if (isActive) {
        const sel = Array.isArray(sessions) ? sessions.find((x: any) => x.id === currentId) : null
        ;(patch as any).feSelectedTemplate = sel?.lastUsedFlow || ((s as any).feSelectedTemplate)
        ;(patch as any).feMainFlowContext = sel?.currentContext || null
        ;(patch as any).feIsolatedContexts = {}


		      }
		      return patch
		    })
		  },

		  ensureSessionPresentFor: ({ workspaceId }: { workspaceId: string }) => {
		    const state: any = get()
		    const isActive = state.workspaceRoot === workspaceId
		    const list: Session[] = (typeof state.getSessionsFor === 'function') ? state.getSessionsFor({ workspaceId }) : []
		    if (!list || list.length === 0) {
		      get().newSessionFor({ workspaceId })
		      return true
		    }
		    const cur = (typeof state.getCurrentIdFor === 'function') ? state.getCurrentIdFor({ workspaceId }) : null
		    if (!cur) {
		      const firstId = list[0].id
		      set((s: any) => {
		        const patch: any = {
		          currentIdByWorkspace: { ...(s.currentIdByWorkspace || {}), [workspaceId]: firstId },
		        }
		        if (isActive)
                {
          const sel = Array.isArray(list) ? list.find((x: any) => x.id === firstId) : null
          ;(patch as any).feSelectedTemplate = sel?.lastUsedFlow || ((s as any).feSelectedTemplate)
          ;(patch as any).feMainFlowContext = sel?.currentContext || null
          ;(patch as any).feIsolatedContexts = {}



                }

		        return patch
		      })
		      return false
		    }
		    return false
		  },

		  initializeSessionFor: async ({ workspaceId }: { workspaceId: string }) => {
		    const state: any = get()
		    const isActive = state.workspaceRoot === workspaceId
		    if (isActive && typeof state.initializeSession === 'function') {
		      await state.initializeSession()
		    }
		  },



  // Session Actions
  loadSessions: async () => {
    const state: any = get()
    const ws = state.workspaceRoot || null
    if (ws && typeof state.loadSessionsFor === 'function') {
      await state.loadSessionsFor({ workspaceId: ws })
    }
  },

  /**
   * Initialize the current session
   * - Loads the flow template (lastUsedFlow or default)
   * - Sets feSelectedTemplate to match the session's flow
   * - Starts the flow execution
   * - Ensures a terminal exists for the session
   */
  initializeSession: async () => {
    const state = get() as any
    const ws = state.workspaceRoot || null
    const sid = (ws && typeof state.getCurrentIdFor === 'function') ? state.getCurrentIdFor({ workspaceId: ws }) : null
    const list: Session[] = (ws && typeof state.getSessionsFor === 'function') ? (state.getSessionsFor({ workspaceId: ws }) || []) : []
    const currentSession = Array.isArray(list) ? list.find((s: Session) => s.id === sid) : null
    if (!currentSession) { return }

    // Create the PTY session for this session (using session ID as PTY session ID)
    const workspaceRoot = state.workspaceRoot
    console.log('[session] Creating PTY for session:', currentSession.id)
    await agentPty.getOrCreateAgentPtyFor(currentSession.id, { cwd: workspaceRoot || undefined })

    // Ensure terminal tab exists
    if (state.ensureSessionTerminal) {
      await state.ensureSessionTerminal()
    }

    // Load the flow template
    const flowTemplateId = currentSession.lastUsedFlow || 'default'

    // Set the selected template to match the session's flow (via any cast since it's in FlowEditorSlice)
    ;(set as any)({ feSelectedTemplate: flowTemplateId })

    if (state.feLoadTemplate) {
      await state.feLoadTemplate({ templateId: flowTemplateId })
    }

    // Update session's lastUsedFlow if it wasn't set
    if (!currentSession.lastUsedFlow) {
      const sessions = list.map((s: Session) =>
        s.id === sid
          ? { ...s, lastUsedFlow: flowTemplateId, updatedAt: Date.now() }
          : s
      )
      set((s: any) => {
        const ws = (s as any).workspaceRoot || null
        if (!ws) return {}
        const sid = ((s as any).currentIdByWorkspace?.[ws] ?? null)
        return {
          sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions },
          currentIdByWorkspace: { ...((s as any).currentIdByWorkspace || {}), [ws]: sid },
        }
      })
      if (state.saveCurrentSession) {
        await state.saveCurrentSession()
      }
    }

    // Start the flow after session is fully initialized
    if (state.flowInit) {
      await state.flowInit()
    }

  },

  ensureSessionPresent: () => {
    const state: any = get()
    const ws = state.workspaceRoot || null
    if (ws && typeof state.ensureSessionPresentFor === 'function') {
      return state.ensureSessionPresentFor({ workspaceId: ws })
    }
    return false
  },

  saveCurrentSession: async (immediate = false) => {
    const state: any = get()
    const ws = state.workspaceRoot || null

    let current: any = null
    if (ws && state.sessionsByWorkspace && state.currentIdByWorkspace) {
      const list = state.sessionsByWorkspace[ws] || []
      const id = state.currentIdByWorkspace[ws] ?? null
      current = Array.isArray(list) ? list.find((sess: any) => sess.id === id) : null
    }
    if (!current) {
      console.warn('[saveCurrentSession] No current session found')
      return
    }

    // Save to disk using debounced saver
    // When immediate=true, await the save to ensure it completes before returning
    const saveResult = sessionSaver.save(current, immediate)
    if (immediate && saveResult) {
      await saveResult
    }
  },

  updateCurrentSessionFlow: async (flowId: string) => {
    const state: any = get()
    const ws = state.workspaceRoot || null
    if (!ws || typeof state.getCurrentIdFor !== 'function' || typeof state.getSessionsFor !== 'function') return
    const id = state.getCurrentIdFor({ workspaceId: ws })
    if (!id) return

    const prevList: Session[] = state.getSessionsFor({ workspaceId: ws }) || []

    const sessions = prevList.map((s: any) =>
      s.id === id ? { ...s, lastUsedFlow: flowId, updatedAt: Date.now() } : s
    )

    set((s: any) => {
      const ws2 = (s as any).workspaceRoot || null
      if (!ws2) return {}
      const sid2 = ((s as any).currentIdByWorkspace?.[ws2] ?? null)
      return {
        sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws2]: sessions },
        currentIdByWorkspace: { ...((s as any).currentIdByWorkspace || {}), [ws2]: sid2 },
      }
    })

    await get().saveCurrentSession()
  },

  setSessionExecutedFlow: async ({ sessionId, flowId }: { sessionId: string; flowId: string }) => {
    const state: any = get()
    const ws = state.workspaceRoot || null
    const prevList: Session[] = (ws && typeof state.getSessionsFor === 'function')
      ? (state.getSessionsFor({ workspaceId: ws }) || [])
      : []
    const sessions = prevList.map((s: any) =>
      s.id === sessionId ? { ...s, lastUsedFlow: flowId, updatedAt: Date.now() } : s
    )
    set((s: any) => {
      const ws2 = (s as any).workspaceRoot || null
      if (!ws2) return {}
      const sid2 = ((s as any).currentIdByWorkspace?.[ws2] ?? null)
      return {
        sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws2]: sessions },
        currentIdByWorkspace: { ...((s as any).currentIdByWorkspace || {}), [ws2]: sid2 },
      }
    })
    await get().saveCurrentSession()
  },

  setSessionProviderModel: async ({ sessionId, provider, model }: { sessionId: string; provider: string; model: string }) => {
    set((s: any) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: Session[] = ((s as any).sessionsByWorkspace?.[ws]) || []
      const sessions = prevList.map((sess: any) => {
        if (sess.id !== sessionId) return sess
        return {
          ...sess,
          currentContext: {
            ...sess.currentContext,
            provider,
            model,
          },
          updatedAt: Date.now(),
        }
      })
      const sid = ((s as any).currentIdByWorkspace?.[ws] ?? null)
      return {
        sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions },
        currentIdByWorkspace: { ...((s as any).currentIdByWorkspace || {}), [ws]: sid },
      }
    })
    await get().saveCurrentSession()
  },

  select: (id: string) => {
    const state: any = get()
    const ws = state.workspaceRoot || null
    if (!ws || typeof state.selectFor !== 'function') return
    state.selectFor({ workspaceId: ws, id })
  },

  newSession: (title?: string) => {
    const state: any = get()
    const ws = state.workspaceRoot || null
    if (!ws || typeof state.newSessionFor !== 'function') return ''
    return state.newSessionFor({ workspaceId: ws, title })
  },

  rename: ({ id, title }: { id: string; title: string }) => {
    set((s: any) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: Session[] = (((s as any).sessionsByWorkspace?.[ws]) || [])
      const sessions = prevList.map((sess: any) =>
        sess.id === id ? { ...sess, title, updatedAt: Date.now() } : sess
      )
      const sid = ((s as any).currentIdByWorkspace?.[ws] ?? null)
      return {
        sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions },
        currentIdByWorkspace: { ...((s as any).currentIdByWorkspace || {}), [ws]: sid },
      }
    })

    // Save the renamed session
    get().saveCurrentSession()
  },

  remove: async (id: string) => {
    set((s: any) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: Session[] = (((s as any).sessionsByWorkspace?.[ws]) || [])
      const filtered = prevList.filter((sess: any) => sess.id !== id)
      const prevCurrent = ((s as any).currentIdByWorkspace?.[ws] ?? null)
      const currentId = prevCurrent === id ? (filtered[0]?.id ?? null) : prevCurrent
      return {
        sessionsByWorkspace: { ...((s as any).sessionsByWorkspace || {}), [ws]: filtered },
        currentIdByWorkspace: { ...((s as any).currentIdByWorkspace || {}), [ws]: currentId },
      }
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

    // Debug logging (workspace-aware)
    try {
      const st: any = get()
      const ws = st.workspaceRoot || null
      const currentIdForLog = (ws && typeof st.getCurrentIdFor === 'function')
        ? st.getCurrentIdFor({ workspaceId: ws })
        : null
      const sessionsForLog = (ws && typeof st.getSessionsFor === 'function')
        ? (st.getSessionsFor({ workspaceId: ws }) || [])
        : []
      console.log('[addSessionItem] Adding item:', {
        type: item.type,
        role: (item as any).role,
        contentLength: (item as any).content?.length || 0,
        currentId: currentIdForLog,
        sessionCount: sessionsForLog.length,
      })
    } catch {}

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
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = (((s as any).currentIdByWorkspace || {})[ws] ?? null)
      if (!sid) {
        console.warn('[addSessionItem] No currentId (workspace-scoped), skipping')
        return {}
      }

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if (sess.id !== sid) return sess

        // Update title if this is the first user message
        let newTitle = sess.title
        if (item.type === 'message' && (item as any).role === 'user') {
          const hasMessages = sess.items.some((i: any) => i.type === 'message')
          if (!hasMessages) {
            const isInitial = String(sess.title || '') === initialSessionTitle(sess.createdAt)
            if (isInitial) {
              newTitle = deriveTitle((item as any).content, sess.createdAt)
            }
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

      try { console.log('[addSessionItem] Updated sessions, new item count:', sessions.find((s2: any) => s2.id === sid)?.items.length) } catch {}
      const patch: any = {}
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      }
      return patch
    })

    // Debounced save after adding item
    get().saveCurrentSession()
  },

  updateSessionItem: ({ id, updates }: { id: string; updates: Partial<SessionItem> }) => {
    set((s) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = (((s as any).currentIdByWorkspace || {})[ws] ?? null)
      if (!sid) return {}

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if (sess.id !== sid) return sess

        return {
          ...sess,
          items: sess.items.map((item: any) =>
            item.id === id ? ({ ...item, ...updates } as SessionItem) : item
          ),
          updatedAt: Date.now(),
        }
      })

      const patch: any = {}
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      }
      return patch
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
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = (((s as any).currentIdByWorkspace || {})[ws] ?? null)
      if (!sid) return {}

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if (sess.id !== sid) return sess

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

      const patch: any = {}
      patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
      patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      return patch
    })

    // Debounced save after context update
    get().saveCurrentSession()
  },

  // Clear timeline and reset message history; stop any running flow first
  startNewContext: async () => {
    const state: any = get()
    try {
      const running = state.feStatus === 'running' || state.feStatus === 'waitingForInput'
      if (running && typeof state.feStop === 'function') {
        await state.feStop()
      }
    } catch {}

    set((s) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = (((s as any).currentIdByWorkspace || {})[ws] ?? null)
      if (!sid) return {}

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if (sess.id !== sid) return sess
        const now = Date.now()
        return {
          ...sess,
          items: [],
          currentContext: {
            ...(sess.currentContext || {}),
            messageHistory: []
          },
          lastActivityAt: now,
          updatedAt: now,
        }
      })

      const patch: any = { openExecutionBoxes: {} }
      patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
      patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      return patch
    })

    try { await get().saveCurrentSession(true) } catch {}

    // Ensure inspector reflects cleared ephemeral contexts when not running
    try { (set as any)({ feMainFlowContext: null, feIsolatedContexts: {} }) } catch {}
  },



  // Token Usage Actions
  recordTokenUsage: ({ sessionId: _sessionId, requestId, nodeId, executionId, provider, model, usage }: { sessionId?: string; requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }) => {
    const state = get() as any

    set((s) => {
      const inFlight: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }> = (s as any).inFlightUsageByKey || {}
      const key = `${requestId}:${nodeId}:${executionId}`
      const prev = inFlight[key]?.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }

      // All providers (OpenAI, Anthropic, Gemini, Fireworks, xAI) report CUMULATIVE usage per-step.
      // Calculate the delta by subtracting previous cumulative from current cumulative.
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

  finalizeNodeUsage: ({ sessionId, requestId, nodeId, executionId }: { sessionId?: string; requestId: string; nodeId: string; executionId: string }) => {
    const state = get() as any

    set((s) => {
      const accMap: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }> = (s as any).inFlightUsageByKey || {}
      const key = `${requestId}:${nodeId}:${executionId}`
      const acc = accMap[key]
      if (!acc) return {}

      const ws = (s as any).workspaceRoot || null
      if (!ws) {
        const { [key]: _, ...rest } = accMap
        return { inFlightUsageByKey: rest }
      }
      const sid = sessionId || (((s as any).currentIdByWorkspace || {})[ws] ?? null)
      if (!sid) {
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

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if (sess.id !== sid) return sess

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
      const patch: any = { inFlightUsageByKey: rest }
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      }
      return patch
    })

    get().saveCurrentSession()
  },

  finalizeRequestUsage: ({ sessionId, requestId }: { sessionId?: string; requestId: string }) => {
    const state = get() as any

    set((s) => {
      const accMap: Record<string, { requestId: string; nodeId: string; executionId: string; provider: string; model: string; usage: TokenUsage }> = (s as any).inFlightUsageByKey || {}
      const prefix = `${requestId}:`
      const keys = Object.keys(accMap).filter(k => k.startsWith(prefix))
      if (!keys.length) return {}

      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = sessionId || (((s as any).currentIdByWorkspace || {})[ws] ?? null)

      let sessions: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      for (const key of keys) {
        const acc = accMap[key]
        if (!acc) continue
        if (!sid) continue
        const { provider, model, usage } = acc
        const cost = state.calculateCost ? state.calculateCost(provider, model, usage) : null

        if (DEBUG_USAGE) {
          try { console.log('[usage:finalizeRequestUsage]', { requestId, key, provider, model, final: usage, cost }) } catch {}
        }

        sessions = sessions.map((sess: any) => {
          if (sess.id !== sid) return sess

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
      const patch: any = { inFlightUsageByKey: rest }
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      }
      return patch
    })

    get().saveCurrentSession()
  },

  // Flow Debug Log Actions
  addFlowDebugLog: (log) => {
    const stateAny = get() as any
    const ws = stateAny.workspaceRoot || null
    if (!ws || typeof stateAny.getCurrentIdFor !== 'function') return
    const currentId = stateAny.getCurrentIdFor({ workspaceId: ws })
    if (!currentId) return

    set((s) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
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

      const patch: any = {}
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: currentId }
      }
      return patch
    })

    // Save after adding log
    get().saveCurrentSession()
  },

  clearFlowDebugLogs: () => {
    const stateAny = get() as any
    const ws = stateAny.workspaceRoot || null
    const currentId = (ws && typeof stateAny.getCurrentIdFor === 'function')
      ? stateAny.getCurrentIdFor({ workspaceId: ws })
      : null
    if (!currentId) return

    set((s) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if (sess.id !== currentId) return sess

        return {
          ...sess,
          flowDebugLogs: [],
          updatedAt: Date.now(),
        }
      })

      if (!ws) return {}
      const patch: any = {}
      patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
      patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: currentId }
      return patch
    })

    // Save after clearing logs
    get().saveCurrentSession()
  },

  // Flow Cache Actions
  getNodeCache: (nodeId: string) => {
    const stateAny = get() as any
    const ws = stateAny.workspaceRoot || null
    if (!ws || typeof stateAny.getCurrentIdFor !== 'function') return undefined
    const currentId = stateAny.getCurrentIdFor({ workspaceId: ws })
    if (!currentId) return undefined

    if (typeof stateAny.getSessionsFor !== 'function') return undefined
    const sessions = (stateAny.getSessionsFor({ workspaceId: ws }) || [])
    const currentSession = (sessions as any[]).find((s) => (s as any).id === currentId)
    return (currentSession as any)?.flowCache?.[nodeId]
  },

  setNodeCache: async (nodeId: string, cache: { data: any; timestamp: number }) => {
    const stateAny = get() as any
    const ws = stateAny.workspaceRoot || null
    if (!ws || typeof stateAny.getCurrentIdFor !== 'function') return
    const currentId = stateAny.getCurrentIdFor({ workspaceId: ws })
    if (!currentId) return

    console.log('[session] Setting cache for node:', nodeId)

    set((s) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if ((sess as any).id !== currentId) return sess

        // Update the node's cache entry
        const flowCache = { ...(sess as any).flowCache, [nodeId]: cache }

        return {
          ...(sess as any),
          flowCache,
          updatedAt: Date.now(),
        }
      })

      const patch: any = {}
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: currentId }
      }
      return patch
    })

    // Save after setting cache
    await get().saveCurrentSession() // debounced save
  },

  clearNodeCache: async (nodeId: string) => {
    const stateAny = get() as any
    const ws = stateAny.workspaceRoot || null
    if (!ws || typeof stateAny.getCurrentIdFor !== 'function') return
    const currentId = stateAny.getCurrentIdFor({ workspaceId: ws })
    if (!currentId) return

    console.log('[session] Clearing cache for node:', nodeId)

    set((s) => {
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if ((sess as any).id !== currentId) return sess

        // Remove the node's cache entry
        const flowCache = { ...(sess as any).flowCache }
        delete (flowCache as any)[nodeId]

        return {
          ...(sess as any),
          flowCache,
          updatedAt: Date.now(),
        }
      })

      if (!ws) return {}
      const patch: any = {}
      patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
      patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: currentId }
      return patch
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
        const ws = (s as any).workspaceRoot || null
        if (!ws) return {}
        const sid = ((((s as any).currentIdByWorkspace || {})[ws]) ?? null)
        if (!sid) return {}

        // Find existing open box for this nodeId
        const openBoxId = (s as any).openExecutionBoxes[nodeId]
        let newBoxId: string | null = null

        const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

        const sessions = prevList.map((sess: any) => {
          if ((sess as any).id !== sid) return sess

          const existingBoxIndex = openBoxId
            ? (sess as any).items.findIndex((item: any) => item.id === openBoxId)
            : -1

          if (existingBoxIndex !== -1) {
            // Box exists - append content
            const items = [ ...(sess as any).items ]
            const box = items[existingBoxIndex] as any
            items[existingBoxIndex] = {
              ...box,
              content: [...box.content, ...contentToAdd]
            }

            return {
              ...(sess as any),
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
              ...(sess as any),
              items: [ ...(sess as any).items, newBox ],
              updatedAt: Date.now()
            }
          }
        })

        const patch: any = {}
        if (ws) {
          patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
          patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
        }

        // Update open boxes map if we created a new box
        if (newBoxId) {
          patch.openExecutionBoxes = {
            ...((s as any).openExecutionBoxes),
            [nodeId]: newBoxId
          }
        }

        return patch
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
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = ((((s as any).currentIdByWorkspace || {})[ws]) ?? null)
      if (!sid) return {}

      const openBoxId = (s as any).openExecutionBoxes[nodeId]
      if (!openBoxId) return {} // No open box for this node

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if ((sess as any).id !== sid) return sess

        const boxIndex = (sess as any).items.findIndex((item: any) => item.id === openBoxId)
        if (boxIndex === -1) return sess

        const box = (sess as any).items[boxIndex] as any
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

        const items = [ ...(sess as any).items ]
        items[boxIndex] = {
          ...box,
          content: updatedContent
        }

        return {
          ...(sess as any),
          items,
          updatedAt: Date.now()
        }
      })

      const patch: any = {}
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      }
      return patch
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
      const ws = (s as any).workspaceRoot || null
      if (!ws) return {}
      const sid = ((((s as any).currentIdByWorkspace || {})[ws]) ?? null)
      if (!sid) return {}

      const openBoxId = (s as any).openExecutionBoxes[nodeId]
      if (!openBoxId) return {} // No box to finalize

      const prevList: any[] = ((((s as any).sessionsByWorkspace || {})[ws]) || [])

      const sessions = prevList.map((sess: any) => {
        if ((sess as any).id !== sid) return sess

        const boxIndex = (sess as any).items.findIndex((item: any) => item.id === openBoxId)

        if (boxIndex !== -1 && cost) {
          const items = [ ...(sess as any).items ]
          const box = items[boxIndex] as any
          items[boxIndex] = {
            ...box,
            cost
          }

          return {
            ...(sess as any),
            items,
            updatedAt: Date.now()
          }
        }

        return sess
      })

      // Remove from open boxes map so next execution creates a new box
      const newOpenBoxes = { ...((s as any).openExecutionBoxes) }
      delete (newOpenBoxes as any)[nodeId]

      const patch: any = { openExecutionBoxes: newOpenBoxes }
      if (ws) {
        patch.sessionsByWorkspace = { ...((s as any).sessionsByWorkspace || {}), [ws]: sessions }
        patch.currentIdByWorkspace = { ...((s as any).currentIdByWorkspace || {}), [ws]: sid }
      }
      return patch
    })

    // Immediate save on finalize
    void get().saveCurrentSession(true)
  },
})

