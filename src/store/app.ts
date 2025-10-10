import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { listModels } from '../services/models'
import { setAppView } from '../services/appBridge'
import * as ptySvc from '../services/pty'
import { DEFAULT_PRICING, type ModelPricing, type ProviderPricing, type PricingConfig } from '../data/defaultPricing'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'

export type ViewType = 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings'

// LocalStorage keys (centralized)
const LS_KEYS = {
  app: 'hifide:app',
  model: 'hifide:model',
  provider: 'hifide:provider',
  view: 'hifide:view',
  folder: 'hifide:folder',
  defaultModels: 'hifide:defaultModels',
  autoApproveEnabled: 'hifide:autoApproveEnabled',
  autoApproveThreshold: 'hifide:autoApproveThreshold',
  autoEnforceEditsSchema: 'hifide:autoEnforceEditsSchema',
  pricing: 'hifide:pricing',
  sessionsCurrent: 'hifide:sessions:current',
  conversations: 'hifide:conversations',
  conversationsCurrent: 'hifide:conversations:current',
} as const


type PtySession = { tabId: string; sessionId: string; cols: number; rows: number; cwd?: string; shell?: string; context: 'agent' | 'explorer' }

type TerminalInstance = {
  terminal: Terminal
  fitAddon: FitAddon
  container: HTMLElement | null
  resizeObserver: ResizeObserver | null
  resizeTimeout: NodeJS.Timeout | null
}

export type RouteRecord = { requestId: string; mode: 'chat'|'tools'; provider: string; model: string; timestamp: number }

export type DebugLogEntry = { timestamp: number; level: 'info' | 'warning' | 'error'; category: string; message: string; data?: any }

type IndexStatus = { ready: boolean; chunks: number; modelId?: string; dim?: number; indexPath: string }
type IndexProgress = { inProgress?: boolean; phase?: string; processedFiles?: number; totalFiles?: number; processedChunks?: number; totalChunks?: number; elapsedMs?: number }

type ModelOption = { value: string; label: string }

// Chat state (centralized in App store)
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type TokenCost = {
  inputCost: number
  outputCost: number
  totalCost: number
  currency: string  // 'USD'
}

// Re-export pricing types
export type { ModelPricing, ProviderPricing, PricingConfig }

export type Session = {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  tokenUsage: {
    byProvider: Record<string, TokenUsage>
    total: TokenUsage
  }
  costs: {
    byProviderAndModel: Record<string, Record<string, TokenCost>>  // provider -> model -> cost
    totalCost: number
    currency: string
  }
}

// Sessions are now loaded from files, not localStorage
async function loadSessions(): Promise<{ sessions: Session[]; currentId: string | null }> {
  try {
    if (!window.sessions) {
      // Fallback: create a default session
      const first: Session = {
        id: crypto.randomUUID(),
        title: 'New Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tokenUsage: { byProvider: {}, total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
        costs: { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
      }
      return { sessions: [first], currentId: first.id }
    }

    const result = await window.sessions.list()
    if (result.ok && result.sessions && result.sessions.length > 0) {
      // Ensure all sessions have costs field (for backward compatibility)
      const sessions = result.sessions.map((sess: any) => ({
        ...sess,
        costs: sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
      }))
      // Get current session ID from localStorage (temporary until we have a better solution)
      const currentId = localStorage.getItem(LS_KEYS.sessionsCurrent) || sessions[0].id
      return { sessions, currentId }
    }
  } catch (e) {
    console.error('Failed to load sessions:', e)
  }

  // Fallback: create a default session
  const first: Session = {
    id: crypto.randomUUID(),
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tokenUsage: { byProvider: {}, total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    costs: { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
  }
  return { sessions: [first], currentId: first.id }
}


function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0].trim()
  if (!firstLine) return 'New Chat'
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
}

// Sessions will be loaded asynchronously during app initialization
const chatInitial = {
  sessions: [] as Session[],
  currentId: null as string | null
}

	export type AppState = {
  // Boot/initialization state
  appBootstrapping: boolean
  startupMessage: string | null
  initializeApp: () => Promise<void>
  setStartupMessage: (msg: string | null) => void

  // View state
  currentView: ViewType
  setCurrentView: (view: ViewType) => void

  // Workspace state
  workspaceRoot: string | null
  setWorkspaceRoot: (folder: string | null) => void
  recentFolders: Array<{ path: string; lastOpened: number }>
  addRecentFolder: (path: string) => void
  clearRecentFolders: () => void
  openFolder: (folderPath: string) => Promise<{ ok: boolean; error?: string }>
  hasUnsavedChanges: () => boolean
  fileWatchCleanup: (() => void) | null
  fileWatchEvent: { path: string; type: 'rename' | 'change'; timestamp: number } | null

  // File explorer state
  explorerOpenFolders: Set<string>
  explorerChildrenByDir: Record<string, Array<{ name: string; isDirectory: boolean; path: string }>>
  loadExplorerDir: (dirPath: string) => Promise<void>
  toggleExplorerFolder: (dirPath: string) => Promise<void>

  // Model/Provider state
  selectedModel: string
  setSelectedModel: (m: string) => void
  selectedProvider: string
  setSelectedProvider: (p: string) => void
  autoRetry: boolean
  setAutoRetry: (v: boolean) => void


	  // Keep provider/model selections valid based on validated providers and available models
	  ensureProviderModelConsistency: () => void,

  // Provider validation state (controls provider visibility in UI)
  providerValid: Record<string, boolean>
  setProviderValid: (provider: string, valid: boolean) => void
  setProvidersValid: (map: Record<string, boolean>) => void

  // Settings state and actions (centralized business logic)
  settingsApiKeys: { openai: string; anthropic: string; gemini: string }
  settingsSaving: boolean
  settingsSaved: boolean
  setSettingsApiKey: (provider: 'openai' | 'anthropic' | 'gemini', value: string) => void
  loadSettingsApiKeys: () => Promise<void>
  saveSettingsApiKeys: () => Promise<{ ok: boolean; failures: string[] }>
  resetSettingsSaved: () => void

  // Available models per provider (single source of truth for UI)
  modelsByProvider: Record<string, ModelOption[]>
  setModelsForProvider: (provider: string, models: ModelOption[]) => void
  refreshModels: (provider: 'openai' | 'anthropic' | 'gemini') => Promise<void>
  refreshAllModels: () => Promise<void>

  // Default models per provider
  defaultModels: Record<string, string>
  setDefaultModel: (provider: string, model: string) => void

  // Auto-approve policy (agent-initiated risky commands)
  autoApproveEnabled: boolean
  setAutoApproveEnabled: (v: boolean) => void
  autoApproveThreshold: number // 0..1
  setAutoApproveThreshold: (v: number) => void

  // Agent behavior settings
  autoEnforceEditsSchema: boolean
  setAutoEnforceEditsSchema: (v: boolean) => void

  // UI state
  metaPanelOpen: boolean
  setMetaPanelOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void

  // Route history for Auto router
  routeHistory: RouteRecord[]
  // Context refresh (bootstrap) state
  ctxRefreshing: boolean
  ctxResult: (null | { ok: boolean; createdPublic?: boolean; createdPrivate?: boolean; ensuredGitIgnore?: boolean; generatedContext?: boolean; error?: string })
  refreshContext: () => Promise<void>

  // Indexing state
  idxStatus: IndexStatus | null
  idxLoading: boolean
  idxQuery: string
  idxResults: Array<{ path: string; startLine: number; endLine: number; text: string }>
  idxProg: IndexProgress | null
  ensureIndexProgressSubscription: () => void
  refreshIndexStatus: () => Promise<void>
  rebuildIndex: () => Promise<{ ok: boolean; status?: IndexStatus | null; error?: unknown } | undefined>
  clearIndex: () => Promise<{ ok: boolean } | undefined>
  setIdxQuery: (q: string) => void
  searchIndex: () => Promise<void>

  pushRouteRecord: (r: RouteRecord) => void

  // Terminal panel UI (per view)
  agentTerminalPanelOpen: boolean
  setAgentTerminalPanelOpen: (open: boolean) => void
  agentTerminalPanelHeight: number
  setAgentTerminalPanelHeight: (h: number) => void

  explorerTerminalPanelOpen: boolean
  setExplorerTerminalPanelOpen: (open: boolean) => void
  toggleExplorerTerminalPanel: () => void
  explorerTerminalPanelHeight: number
  setExplorerTerminalPanelHeight: (h: number) => void

  // Terminal tabs (per context)
  agentTerminalTabs: string[]
  agentActiveTerminal: string | null
  explorerTerminalTabs: string[]
  explorerActiveTerminal: string | null
  agentSessionTerminals: Record<string, string[]> // sessionId -> tabIds (for future restoration)
  addTerminalTab: (context: 'agent' | 'explorer') => string
  removeTerminalTab: (context: 'agent' | 'explorer', tabId: string) => void
  setActiveTerminal: (context: 'agent' | 'explorer', tabId: string | null) => void
  clearAgentTerminals: () => Promise<void>
  clearExplorerTerminals: () => Promise<void>

  // Terminal instances (xterm)
  terminals: Record<string, TerminalInstance> // keyed by tabId
  mountTerminal: (tabId: string, container: HTMLElement, context: 'agent' | 'explorer') => Promise<void>
  remountTerminal: (tabId: string, container: HTMLElement) => void
  unmountTerminal: (tabId: string) => void
  fitTerminal: (tabId: string) => void
  fitAllTerminals: (context: 'agent' | 'explorer') => void

  // PTY sessions and routing
  ptyInitialized: boolean
  ptySessions: Record<string, PtySession> // keyed by tabId
  ptyBySessionId: Record<string, string> // sessionId -> tabId
  ptySubscribers: Record<string, (data: string) => void | undefined>
  ensurePtyInfra: () => void
  ensurePtySession: (tabId: string, opts?: { cwd?: string; shell?: string; cols?: number; rows?: number; context?: 'agent' | 'explorer' }) => Promise<{ sessionId: string }>
  writePty: (tabId: string, data: string) => Promise<{ ok: boolean }>
  resizePty: (tabId: string, cols: number, rows: number) => Promise<{ ok: boolean }>
  disposePty: (tabId: string) => Promise<{ ok: boolean }>
  subscribePtyData: (tabId: string, fn: (data: string) => void) => () => void


	  // Open a file into the editor, inferring language
	  openFile: (path: string) => Promise<void>

  // Editor state
  openedFile: { path: string; content: string; language: string } | null

  // Session state (centralized) - renamed from conversations
  sessions: Session[]
  currentId: string | null
  sessionsLoaded: boolean
  loadSessions: () => Promise<void>
  saveCurrentSession: () => Promise<void>
  select: (id: string) => void
  newSession: (title?: string) => string
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  addUserMessage: (content: string) => void
  addAssistantMessage: (content: string) => void
  getCurrentMessages: () => ChatMessage[]

  // Token usage tracking
  lastRequestTokenUsage: { provider: string; model: string; usage: TokenUsage } | null
  recordTokenUsage: (provider: string, model: string, usage: TokenUsage) => void

  // Agent metrics (from main process)
  agentMetrics: null | { requestId: string; tokensUsed: number; tokenBudget: number; iterationsUsed: number; maxIterations: number; percentageUsed: number }
  ensureAgentMetricsSubscription: () => void


	  // LLM request lifecycle/streaming (centralized)
	  currentRequestId: string | null
	  streamingText: string
	  chunkStats: { count: number; totalChars: number }
	  retryCount: number
	  llmIpcSubscribed: boolean
	  ensureLlmIpcSubscription: () => void
	  buildResponseSchemaForInput: (userText: string) => any | undefined
	  startChatRequest: (userText: string) => Promise<void>
	  stopCurrentRequest: () => Promise<void>

  // Pricing configuration
  pricingConfig: PricingConfig
  setPricingForModel: (provider: string, model: string, pricing: ModelPricing) => void
  resetPricingToDefaults: () => void
  resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini') => void
  calculateCost: (provider: string, model: string, usage: TokenUsage) => TokenCost | null

  // Debug logging
  debugLogs: DebugLogEntry[]
  debugPanelCollapsed: boolean
  setDebugPanelCollapsed: (collapsed: boolean) => void
  addDebugLog: (level: 'info' | 'warning' | 'error', category: string, message: string, data?: any) => void
  clearDebugLogs: () => void

}

const defaultModel = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEYS.model)
  ? localStorage.getItem(LS_KEYS.model)!
  : 'gpt-5'
const defaultProviderValid: Record<string, boolean> = { openai: false, anthropic: false, gemini: false }
const defaultDefaultModels: Record<string, string> = (() => {
  try {
    const j = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEYS.defaultModels) : null
    return j ? JSON.parse(j) : {}
  } catch {
    return {}
  }
})()

const defaultProvider = typeof localStorage !== 'undefined' && localStorage.getItem('hifide:provider')
  ? localStorage.getItem('hifide:provider')!
  : 'openai'
const defaultView = (typeof localStorage !== 'undefined' && (localStorage.getItem(LS_KEYS.view) as ViewType))
  || 'agent'
const defaultFolder = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEYS.folder)
  ? localStorage.getItem(LS_KEYS.folder)
  : null
const defaultAutoApproveEnabled = (() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEYS.autoApproveEnabled) === '1' } catch { return false } })()
const defaultAutoApproveThreshold = (() => { try { const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEYS.autoApproveThreshold) : null; return v ? parseFloat(v) : 0.8 } catch { return 0.8 } })()
const defaultAutoEnforceEditsSchema = (() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEYS.autoEnforceEditsSchema) === '1' } catch { return false } })()
const defaultPricingConfig = (() => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEYS.pricing) : null
    return saved ? JSON.parse(saved) : DEFAULT_PRICING
  } catch {
    return DEFAULT_PRICING
  }
})()

export const useAppStore = create<AppState>()(persist((set, get) => ({
  // View state
  // Boot/initialization state
  appBootstrapping: true,
  startupMessage: null,
  setStartupMessage: (msg) => set({ startupMessage: msg }),
  initializeApp: async () => {
    set({ appBootstrapping: true, startupMessage: null })
    try {
      // 1. Get workspace root from main process
      try {
        const root = await window.workspace?.getRoot?.()
        if (root) {
          set({ workspaceRoot: root })
          // Bootstrap workspace folders
          await window.workspace?.bootstrap?.(root, true, false)
        }
      } catch (e) {
        console.error('Failed to initialize workspace:', e)
      }

      // 2. Keys are now stored in electron-store in main process - no sync needed!
      let okey: string | null | undefined = null
      let akey: string | null | undefined = null
      let gkey: string | null | undefined = null
      try {
        ;[okey, akey, gkey] = await Promise.all([
          window.secrets?.getApiKeyFor?.('openai'),
          window.secrets?.getApiKeyFor?.('anthropic'),
          window.secrets?.getApiKeyFor?.('gemini'),
        ])
      } catch {}
      try { console.debug('[init] API keys', { openai: okey, anthropic: akey, gemini: gkey }) } catch {}

      const provs: Array<{ id: 'openai'|'anthropic'|'gemini'; key: string | null | undefined }> = [
        { id: 'openai', key: okey },
        { id: 'anthropic', key: akey },
        { id: 'gemini', key: gkey },
      ]
      let results: Array<{ provider: 'openai'|'anthropic'|'gemini'; ok: boolean }> = []
      try {
        results = await Promise.all(provs.map(async (p) => {
          const k = (p.key || '').toString().trim()
          if (!k) return { provider: p.id, ok: false }
          try {
            const v = await window.secrets?.validateApiKeyFor?.(
              p.id,
              k,
              p.id === 'anthropic' ? 'claude-3-5-sonnet' : (p.id === 'gemini' ? 'gemini-1.5-pro' : undefined)
            )
            return { provider: p.id, ok: !!v?.ok }
          } catch {
            return { provider: p.id, ok: false }
          }
        }))
      } catch {}

      const validMap: Record<string, boolean> = { openai: false, anthropic: false, gemini: false }
      for (const r of results) { validMap[r.provider] = r.ok }
      set({ providerValid: { ...get().providerValid, ...validMap } })

      // Load models for valid providers (parallel)
      try {
        await Promise.all((['openai','anthropic','gemini'] as const).map(async (p) => {
          if (validMap[p]) { try { await get().refreshModels(p) } catch {} }
          else { /* clear */ set({ modelsByProvider: { ...get().modelsByProvider, [p]: [] as any } }) }
        }))
      } catch {}

      if (!validMap.openai && !validMap.anthropic && !validMap.gemini) {
        set({ startupMessage: 'No valid API keys found. Please configure providers in Settings.' })
        try { get().setCurrentView('settings') } catch {}
      }

      // Load sessions from files
      try {
        await get().loadSessions()
      } catch (e) {
        console.error('Failed to load sessions during init:', e)
      }
    } finally {
      set({ appBootstrapping: false })
    }
  },

  currentView: defaultView,
  setCurrentView: (view) => {
    /* persisted via zustand */
    set({ currentView: view })
    setAppView(view)
  },

  // Workspace state
  workspaceRoot: defaultFolder,
  setWorkspaceRoot: (folder) => {
    set({ workspaceRoot: folder })
  },
  recentFolders: [],
  addRecentFolder: (path) => {
    const existing = get().recentFolders
    const filtered = existing.filter(f => f.path !== path)
    const updated = [{ path, lastOpened: Date.now() }, ...filtered].slice(0, 10)
    set({ recentFolders: updated })
    // Notify main process to update menu
    try {
      window.workspace?.notifyRecentFoldersChanged?.(updated)
    } catch (e) {
      console.error('Failed to notify recent folders changed:', e)
    }
  },
  clearRecentFolders: () => {
    set({ recentFolders: [] })
    // Notify main process to update menu
    try {
      window.workspace?.notifyRecentFoldersChanged?.([])
    } catch (e) {
      console.error('Failed to notify recent folders changed:', e)
    }
  },
  fileWatchCleanup: null,
  fileWatchEvent: null,

  // File explorer state
  explorerOpenFolders: new Set<string>(),
  explorerChildrenByDir: {},

  loadExplorerDir: async (dirPath: string) => {
    if (!window.fs) return
    try {
      const res = await window.fs.readDir(dirPath)
      if (res?.success && Array.isArray(res.entries)) {
        const entries = [...res.entries].sort((a: any, b: any) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })
        set({ explorerChildrenByDir: { ...get().explorerChildrenByDir, [dirPath]: entries } })
      }
    } catch (e) {
      console.error('Failed to load directory:', dirPath, e)
    }
  },

  toggleExplorerFolder: async (dirPath: string) => {
    const s = get()
    const isOpen = s.explorerOpenFolders.has(dirPath)

    // Load directory contents if not already loaded
    if (!isOpen && !s.explorerChildrenByDir[dirPath]) {
      await s.loadExplorerDir(dirPath)
    }

    // Toggle open state
    const next = new Set(s.explorerOpenFolders)
    if (isOpen) {
      next.delete(dirPath)
    } else {
      next.add(dirPath)
    }
    set({ explorerOpenFolders: next })
  },



  hasUnsavedChanges: () => {
    const s = get()
    // Check if current session has unsaved messages
    const current = s.sessions.find(sess => sess.id === s.currentId)
    if (current && current.messages.length > 0) {
      // Consider it "unsaved" if there are messages (user might want to keep them)
      return true
    }
    return false
  },

  openFolder: async (folderPath: string) => {
    const perfStart = performance.now()
    console.log('[openFolder] Starting...')

    try {
      const s = get()

      // Don't allow opening folder while app is still initializing
      if (s.appBootstrapping) {
        console.warn('Cannot open folder while app is initializing')
        return { ok: false, error: 'App is still initializing' }
      }

      // Show loading screen
      set({ appBootstrapping: true, startupMessage: 'Opening workspace...' })

      // 1. Check for unsaved changes
      const t1 = performance.now()
      if (s.hasUnsavedChanges()) {
        console.warn('Unsaved changes detected - proceeding anyway (dialog not yet implemented)')
      }
      console.log(`[openFolder] Check unsaved changes: ${(performance.now() - t1).toFixed(2)}ms`)

      // 2. Save current session before switching
      const t2 = performance.now()
      set({ startupMessage: 'Saving current session...' })
      try {
        await s.saveCurrentSession()
      } catch (e) {
        console.error('Failed to save current session:', e)
      }
      console.log(`[openFolder] Save session: ${(performance.now() - t2).toFixed(2)}ms`)

      // 3. Clear all explorer terminals
      const t3 = performance.now()
      set({ startupMessage: 'Cleaning up terminals...' })
      try {
        await s.clearExplorerTerminals()
      } catch (e) {
        console.error('Failed to clear explorer terminals:', e)
      }
      console.log(`[openFolder] Clear terminals: ${(performance.now() - t3).toFixed(2)}ms`)

      // 4. Update workspace root in main process
      const t4 = performance.now()
      set({ startupMessage: 'Switching workspace...' })
      const setRootResult = await window.workspace?.setRoot?.(folderPath)
      if (!setRootResult?.ok) {
        set({ appBootstrapping: false, startupMessage: null })
        return { ok: false, error: setRootResult?.error || 'Failed to set workspace root' }
      }
      console.log(`[openFolder] Set workspace root: ${(performance.now() - t4).toFixed(2)}ms`)

      // 6. Add to recent folders
      const t6 = performance.now()
      s.addRecentFolder(folderPath)
      console.log(`[openFolder] Add to recent: ${(performance.now() - t6).toFixed(2)}ms`)

      // 7. Bootstrap workspace folders (.hifide-public, .hifide-private, etc.)
      const t7 = performance.now()
      set({ startupMessage: 'Initializing workspace folders...' })
      try {
        // Create folders and basic context (no LLM call - fast)
        await window.workspace?.bootstrap?.(folderPath, false, false)
      } catch (e) {
        console.error('Failed to bootstrap workspace:', e)
      }
      console.log(`[openFolder] Bootstrap folders: ${(performance.now() - t7).toFixed(2)}ms`)

      // 7b. Generate AI-enhanced context in the background (don't await - won't block UI)
      // This only runs if context.json doesn't exist yet
      // The LLM call happens asynchronously after the folder is opened
      setTimeout(() => {
        window.workspace?.bootstrap?.(folderPath, true, false).catch((e) => {
          console.error('Failed to generate AI context in background:', e)
        })
      }, 100) // Small delay to ensure UI is responsive first

      // 8. Reload sessions from new workspace
      const t8 = performance.now()
      set({ startupMessage: 'Loading sessions...' })
      try {
        await s.loadSessions()
      } catch (e) {
        console.error('Failed to load sessions from new workspace:', e)
      }
      console.log(`[openFolder] Load sessions: ${(performance.now() - t8).toFixed(2)}ms`)

      // 9. Start a new explorer terminal
      const t9 = performance.now()
      set({ startupMessage: 'Setting up terminal...' })
      try {
        const newTabId = crypto.randomUUID()
        set({
          explorerTerminalTabs: [newTabId],
          explorerActiveTerminal: newTabId
        })
      } catch (e) {
        console.error('Failed to create new explorer terminal:', e)
      }
      console.log(`[openFolder] Create terminal: ${(performance.now() - t9).toFixed(2)}ms`)

      // 10. Update workspace root and load the initial directory
      const t10 = performance.now()
      set({
        workspaceRoot: folderPath,
        startupMessage: 'Loading file tree...',
        explorerOpenFolders: new Set([folderPath]),
        explorerChildrenByDir: {}
      })

	      // 10b. Check index status and build if needed; then refresh context
	      try {
	        set({ startupMessage: 'Checking code index...' })
	        await get().refreshIndexStatus()
	        const st = get().idxStatus
	        const ready = !!st?.ready
	        const chunks = st?.chunks ?? 0
	        if (!ready && chunks === 0) {
	          await get().rebuildIndex()
	        }
	      } catch {}
	      try {
	        await get().refreshContext()
	      } catch {}


      // Load the initial file tree directly
      try {
        await get().loadExplorerDir(folderPath)
      } catch (e) {
        console.error('Failed to load initial file tree:', e)
      }
      console.log(`[openFolder] Load file tree: ${(performance.now() - t10).toFixed(2)}ms`)

      // 11. Start file watcher (this is the slow part!)
      const t11 = performance.now()
      set({ startupMessage: 'Starting file watcher...' })
      try {
        if (window.fs?.watchDir) {
          await window.fs.watchDir(folderPath)
        }
      } catch (e) {
        console.error('Failed to start file watcher:', e)
      }
      console.log(`[openFolder] Start file watcher: ${(performance.now() - t11).toFixed(2)}ms`)

      // 12. Set up file watch event handler at store level
      // Remove any existing handler first
      if (get().fileWatchCleanup) {
        try { get().fileWatchCleanup?.() } catch {}
      }

      if (window.fs?.onWatch) {
        const cleanup = window.fs.onWatch((ev: { id: number; type: 'rename' | 'change'; path: string; dir: string }) => {
          const currentRoot = get().workspaceRoot
          if (!currentRoot || !ev?.path) return
          if (!ev.path.startsWith(currentRoot)) return

          // Update store with the file watch event - components can subscribe to this
          set({ fileWatchEvent: { path: ev.path, type: ev.type, timestamp: Date.now() } })
        })
        set({ fileWatchCleanup: cleanup })
      }

      // Done - everything is ready
      set({ appBootstrapping: false, startupMessage: null })
      console.log(`[openFolder] TOTAL TIME: ${(performance.now() - perfStart).toFixed(2)}ms`)
      return { ok: true }
    } catch (error) {
      console.error('Failed to open folder:', error)
      set({ appBootstrapping: false, startupMessage: null })
      return { ok: false, error: String(error) }
    }
  },

  // Context refresh (bootstrap)
  ctxRefreshing: false,
  ctxResult: null,
  refreshContext: async () => {
    const folder = get().workspaceRoot
    if (!folder) return
    set({ ctxRefreshing: true })
    try {
      const res = await window.workspace?.bootstrap?.(folder, true, true)
      if (res) set({ ctxResult: res })
    } finally {
      set({ ctxRefreshing: false })
    }
  },

  // Indexing
  idxStatus: null,
  idxLoading: false,
  idxQuery: '',
  idxResults: [],
  idxProg: null,
  ensureIndexProgressSubscription: (() => {
    let subscribed = false
    return () => {
      if (subscribed) return
      subscribed = true
      const handler = (_: any, p: any) => {
        set({ idxProg: p })
        if (p?.chunks !== undefined) {
          const s = get().idxStatus
          if (s) {
            set({ idxStatus: { ...s, chunks: p.chunks, ready: p.ready ?? s.ready, modelId: p.modelId ?? s.modelId, dim: p.dim ?? s.dim } as IndexStatus })
          }
        }
      }
      try { window.ipcRenderer?.on('index:progress', handler) } catch {}
    }
  })(),
  refreshIndexStatus: async () => {
    try {
      const res = await window.indexing?.status?.()
      if (res?.ok) set({ idxStatus: res.status || null })
    } catch {}
  },
  rebuildIndex: async () => {
    set({ idxLoading: true })
    try {
      const res = await window.indexing?.rebuild?.()
      if (res?.ok) set({ idxStatus: res.status || null })
      return res
    } finally {
      set({ idxLoading: false })
    }
  },
  clearIndex: async () => {
    try {
      const res = await window.indexing?.clear?.()
      if (res?.ok) {
        const s = get().idxStatus
        set({ idxStatus: s ? { ...s, ready: false, chunks: 0 } : s })
      }
      return res
    } catch {}
  },
  setIdxQuery: (q) => set({ idxQuery: q }),
  searchIndex: async () => {
    try {
      const q = get().idxQuery.trim()
      console.log('[searchIndex] Starting search, query:', q)
      const res = await window.indexing?.search?.(q, 20)  // Increased to 20 to see more results
      console.log('[searchIndex] Search result:', res)
      if (res?.ok) {
        console.log('[searchIndex] Setting results, chunks:', res.chunks?.length)
        set({ idxResults: res.chunks || [] })
      } else {
        console.log('[searchIndex] Search failed or no results')
      }
    } catch (e) {
      console.error('[searchIndex] Error:', e)
    }
  },

  // Model/Provider state
  selectedModel: defaultModel,
  setSelectedModel: (m) => {
    /* persisted via zustand */
    set({ selectedModel: m })
  },

  ensureProviderModelConsistency: () => {
    const s = get()
    const validMap = s.providerValid || {}
    const anyValidated = Object.values(validMap).some(Boolean)
    const providerOptions = anyValidated ? (['openai','anthropic','gemini'] as const).filter((p) => validMap[p]) : (['openai','anthropic','gemini'] as const)
    let provider = s.selectedProvider
    if (!providerOptions.includes(provider as any) && providerOptions.length > 0) {
      provider = providerOptions[0]
      set({ selectedProvider: provider })
    }
    const models = s.modelsByProvider[provider] || []
    const preferred = s.defaultModels?.[provider]
    const hasPreferred = preferred && models.some((m) => m.value === preferred)
    if (hasPreferred) {
      if (s.selectedModel !== preferred) set({ selectedModel: preferred })
      return
    }
    if (!models.find((m) => m.value === s.selectedModel)) {
      const first = models[0]
      if (first?.value) set({ selectedModel: first.value })
    }
  },
  selectedProvider: defaultProvider,
  setSelectedProvider: (p) => {
    /* persisted via zustand */
    set({ selectedProvider: p })
  },
  autoRetry: true,
  setAutoRetry: (v) => set({ autoRetry: v }),

  // Auto-approve policy
  autoApproveEnabled: defaultAutoApproveEnabled,
  setAutoApproveEnabled: (v) => {
    /* persisted via zustand */
    set({ autoApproveEnabled: v })
  },
  autoApproveThreshold: defaultAutoApproveThreshold,
  setAutoApproveThreshold: (v) => {
    const clamped = Math.max(0, Math.min(1, v))
    /* persisted via zustand */
    set({ autoApproveThreshold: clamped })
  },

  // Provider validation state
  providerValid: defaultProviderValid,
  setProviderValid: (provider, valid) => set({ providerValid: { ...get().providerValid, [provider]: valid } }),
  setProvidersValid: (map) => set({ providerValid: { ...get().providerValid, ...map } }),

  // Settings state and actions (centralized business logic)
  settingsApiKeys: { openai: '', anthropic: '', gemini: '' },
  settingsSaving: false,
  settingsSaved: false,
  setSettingsApiKey: (provider, value) => {
    set({ settingsApiKeys: { ...get().settingsApiKeys, [provider]: value }, settingsSaved: false })
  },
  loadSettingsApiKeys: async () => {
    try {
      const [okey, akey, gkey] = await Promise.all([
        window.secrets?.getApiKeyFor?.('openai'),
        window.secrets?.getApiKeyFor?.('anthropic'),
        window.secrets?.getApiKeyFor?.('gemini'),
      ])
      set({
        settingsApiKeys: {
          openai: okey || '',
          anthropic: akey || '',
          gemini: gkey || '',
        }
      })
    } catch (e) {
      console.error('[Settings] Failed to load API keys:', e)
    }
  },
  saveSettingsApiKeys: async () => {
    set({ settingsSaving: true, settingsSaved: false })
    const failures: string[] = []
    try {
      const keys = get().settingsApiKeys
      // Save keys to localStorage (via preload)
      await window.secrets?.setApiKeyFor?.('openai', keys.openai.trim())
      await window.secrets?.setApiKeyFor?.('anthropic', keys.anthropic.trim())
      await window.secrets?.setApiKeyFor?.('gemini', keys.gemini.trim())

      // Validate keys (best-effort)
      const vOpenAI = keys.openai ? await window.secrets?.validateApiKeyFor?.('openai', keys.openai) : { ok: true }
      const vAnth = keys.anthropic ? await window.secrets?.validateApiKeyFor?.('anthropic', keys.anthropic, 'claude-3-5-sonnet') : { ok: true }
      const vGem = keys.gemini ? await window.secrets?.validateApiKeyFor?.('gemini', keys.gemini, 'gemini-1.5-pro') : { ok: true }

      if (!vOpenAI?.ok) failures.push(`OpenAI: ${vOpenAI?.error || 'invalid key'}`)
      if (!vAnth?.ok) failures.push(`Anthropic: ${vAnth?.error || 'invalid key'}`)
      if (!vGem?.ok) failures.push(`Gemini: ${vGem?.error || 'invalid key'}`)

      const validMap = {
        openai: Boolean(keys.openai && vOpenAI?.ok),
        anthropic: Boolean(keys.anthropic && vAnth?.ok),
        gemini: Boolean(keys.gemini && vGem?.ok),
      }
      console.log('[Settings] validMap:', validMap)
      set({ providerValid: { ...get().providerValid, ...validMap } })

      // Clear startup message if we now have at least one valid key
      if (validMap.openai || validMap.anthropic || validMap.gemini) {
        set({ startupMessage: null })
      }

      // Refresh models for valid providers
      await Promise.all((['openai','anthropic','gemini'] as const).map(async (p) => {
        if (validMap[p]) {
          console.log(`[Settings] Refreshing models for ${p}`)
          try {
            await get().refreshModels(p)
            console.log(`[Settings] Models for ${p}:`, get().modelsByProvider[p])
          } catch (e) {
            console.error(`[Settings] Failed to refresh models for ${p}:`, e)
          }
        }
      }))

      set({ settingsSaved: true })
      return { ok: failures.length === 0, failures }
    } catch (e: any) {
      failures.push(`Unexpected error: ${e?.message || String(e)}`)
      return { ok: false, failures }
    } finally {
      set({ settingsSaving: false })
    }
  },
  resetSettingsSaved: () => set({ settingsSaved: false }),

  // Centralized models cache + loaders
  modelsByProvider: { openai: [], anthropic: [], gemini: [] },
  setModelsForProvider: (provider, models) => set({ modelsByProvider: { ...get().modelsByProvider, [provider]: models } }),
  refreshModels: async (provider) => {
    try {
      const res = await listModels(provider)
      let list: ModelOption[] = []
      if (res?.ok && Array.isArray(res.models)) {
        const arr = res.models as any[]
        // No additional filtering needed - main process already filtered appropriately
        list = arr
          .filter((m) => !!m?.id)
          .map((m) => ({ value: String(m.id), label: String(m.label || m.id) }))
      }
      console.log(`[refreshModels] ${provider}: ${list.length} models`)
      set({ modelsByProvider: { ...get().modelsByProvider, [provider]: list } })

      // Auto-select first model as default if no default is set OR if current default is not in the list
      const currentDefaults = get().defaultModels
      const currentDefault = currentDefaults?.[provider]
      const isCurrentDefaultValid = currentDefault && list.some(m => m.value === currentDefault)

      if (list.length > 0 && !isCurrentDefaultValid) {
        const firstModel = list[0].value
        console.log(`[refreshModels] Auto-selecting default for ${provider}: ${firstModel} (current: ${currentDefault || 'none'}, valid: ${isCurrentDefaultValid})`)
        get().setDefaultModel(provider, firstModel)
      }
    } catch (e) {
      console.error(`[refreshModels] ${provider} failed:`, e)
      set({ modelsByProvider: { ...get().modelsByProvider, [provider]: [] } })
    }
  },
  refreshAllModels: async () => {
    for (const p of ['openai','anthropic','gemini'] as const) {
      try { await get().refreshModels(p) } catch {}
    }
  },

  // Default models per provider
  defaultModels: defaultDefaultModels,
  setDefaultModel: (provider, model) => {
    const next = { ...get().defaultModels, [provider]: model }
    console.log(`[setDefaultModel] ${provider} = ${model}, full defaults:`, next)
    /* persisted via zustand */
    set({ defaultModels: next })
  },

  // Agent behavior settings
  autoEnforceEditsSchema: defaultAutoEnforceEditsSchema,
  setAutoEnforceEditsSchema: (v) => {
    /* persisted via zustand */
    set({ autoEnforceEditsSchema: v })
  },

  // Route history for Auto router
  routeHistory: [],
  pushRouteRecord: (r) => set({ routeHistory: [r, ...get().routeHistory].slice(0, 20) }),

  // UI state
  metaPanelOpen: true,
  setMetaPanelOpen: (open) => set({ metaPanelOpen: open }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  // Terminal panel UI (per view)
  agentTerminalPanelOpen: false,
  setAgentTerminalPanelOpen: (open) => set({ agentTerminalPanelOpen: open }),
  agentTerminalPanelHeight: 260,
  setAgentTerminalPanelHeight: (h) => set({ agentTerminalPanelHeight: h }),

  explorerTerminalPanelOpen: false,
  setExplorerTerminalPanelOpen: (open) => set({ explorerTerminalPanelOpen: open }),
  toggleExplorerTerminalPanel: () => set({ explorerTerminalPanelOpen: !get().explorerTerminalPanelOpen }),
  explorerTerminalPanelHeight: 260,
  setExplorerTerminalPanelHeight: (h) => set({ explorerTerminalPanelHeight: h }),

  // Terminal tabs (per context)
  agentTerminalTabs: [],
  agentActiveTerminal: null,
  ...(() => {
    // Create one explorer terminal on startup
    const id = `e${crypto.randomUUID().slice(0, 7)}`
    return {
      explorerTerminalTabs: [id],
      explorerActiveTerminal: id,
    }
  })(),
  agentSessionTerminals: {},

  addTerminalTab: (context) => {
    const id = `${context[0]}${crypto.randomUUID().slice(0, 7)}`
    if (context === 'agent') {
      set({
        agentTerminalTabs: [...get().agentTerminalTabs, id],
        agentActiveTerminal: id,
      })
    } else {
      set({
        explorerTerminalTabs: [...get().explorerTerminalTabs, id],
        explorerActiveTerminal: id,
      })
    }
    return id
  },

  removeTerminalTab: (context, tabId) => {
    const st = get()
    if (context === 'agent') {
      const tabs = st.agentTerminalTabs.filter((t) => t !== tabId)
      let active = st.agentActiveTerminal
      if (active === tabId) {
        const idx = st.agentTerminalTabs.indexOf(tabId)
        active = tabs[idx - 1] || tabs[0] || null
      }
      set({ agentTerminalTabs: tabs, agentActiveTerminal: active })
    } else {
      const tabs = st.explorerTerminalTabs.filter((t) => t !== tabId)
      let active = st.explorerActiveTerminal
      if (active === tabId) {
        const idx = st.explorerTerminalTabs.indexOf(tabId)
        active = tabs[idx - 1] || tabs[0] || null
      }
      set({ explorerTerminalTabs: tabs, explorerActiveTerminal: active })
    }
    // Unmount terminal and dispose PTY session
    st.unmountTerminal(tabId)
    void st.disposePty(tabId)
  },

  setActiveTerminal: (context, tabId) => {
    if (context === 'agent') {
      set({ agentActiveTerminal: tabId })
    } else {
      set({ explorerActiveTerminal: tabId })
    }
  },

  clearAgentTerminals: async () => {
    const st = get()
    // Unmount and dispose all agent terminals
    await Promise.all(st.agentTerminalTabs.map((tabId) => {
      st.unmountTerminal(tabId)
      return st.disposePty(tabId)
    }))
    // Clear agent terminal state
    set({ agentTerminalTabs: [], agentActiveTerminal: null })
  },

  clearExplorerTerminals: async () => {
    const st = get()
    // Unmount and dispose all explorer terminals
    await Promise.all(st.explorerTerminalTabs.map((tabId) => {
      st.unmountTerminal(tabId)
      return st.disposePty(tabId)
    }))
    // Clear explorer terminal state
    set({ explorerTerminalTabs: [], explorerActiveTerminal: null })
  },

  // Terminal instances (xterm)
  terminals: {},

  mountTerminal: async (tabId, container, context) => {
    const st = get()

    // Create terminal instance
    const terminal = new Terminal({
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      disableStdin: context === 'agent',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    // Open terminal in container
    terminal.open(container)

    // Wait for fonts to load
    try { await (document as any).fonts?.ready } catch {}

    // Initial fit
    try {
      fitAddon.fit()
    } catch (e) {
      console.error('[mountTerminal] initial fit error:', e)
    }

    // Create PTY session
    const cols = terminal.cols
    const rows = terminal.rows
    try {
      await st.ensurePtySession(tabId, { cols, rows, context })

      // Subscribe to PTY data and write to terminal
      st.subscribePtyData(tabId, (data) => {
        try { terminal.write(data) } catch {}
      })

      // Route terminal input to PTY (if not disabled)
      if (context !== 'agent') {
        terminal.onData((data) => st.writePty(tabId, data))
      }
    } catch (err: any) {
      terminal.writeln(`\r\n[PTY Error: ${err?.message || String(err)}]`)
    }

    // Setup resize observer
    const resizeObserver = new ResizeObserver(() => {
      const instance = get().terminals[tabId]
      if (instance?.resizeTimeout) {
        clearTimeout(instance.resizeTimeout)
      }
      // Use requestAnimationFrame to ensure layout is complete before fitting
      const timeout = setTimeout(() => {
        requestAnimationFrame(() => {
          get().fitTerminal(tabId)
        })
      }, 10)
      // Update the stored timeout
      const current = get().terminals[tabId]
      if (current) {
        set({
          terminals: {
            ...get().terminals,
            [tabId]: { ...current, resizeTimeout: timeout }
          }
        })
      }
    })
    resizeObserver.observe(container)
    // Also observe parent to catch panel resize
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement)
    }

    // Store terminal instance
    set({
      terminals: {
        ...st.terminals,
        [tabId]: { terminal, fitAddon, container, resizeObserver, resizeTimeout: null }
      }
    })
  },

  remountTerminal: (tabId, container) => {
    const st = get()
    const instance = st.terminals[tabId]
    if (!instance) return

    // Disconnect old observer if it exists
    if (instance.resizeObserver) {
      instance.resizeObserver.disconnect()
    }

    // Update container reference
    instance.container = container

    // Reopen terminal in new container
    instance.terminal.open(container)

    // Fit to new container size
    try {
      instance.fitAddon.fit()
      const { cols, rows } = instance.terminal
      instance.terminal.resize(cols, rows)
      instance.terminal.scrollToBottom()
      st.resizePty(tabId, cols, rows)
    } catch (e) {
      console.error('[remountTerminal] fit error:', e)
    }

    // Setup new resize observer
    const resizeObserver = new ResizeObserver(() => {
      const inst = get().terminals[tabId]
      if (inst?.resizeTimeout) {
        clearTimeout(inst.resizeTimeout)
      }
      const timeout = setTimeout(() => {
        requestAnimationFrame(() => {
          get().fitTerminal(tabId)
        })
      }, 10)
      const current = get().terminals[tabId]
      if (current) {
        set({
          terminals: {
            ...get().terminals,
            [tabId]: { ...current, resizeTimeout: timeout }
          }
        })
      }
    })
    resizeObserver.observe(container)
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement)
    }

    // Update instance with new observer
    set({
      terminals: {
        ...st.terminals,
        [tabId]: { ...instance, container, resizeObserver }
      }
    })
  },

  unmountTerminal: (tabId) => {
    const st = get()
    const instance = st.terminals[tabId]
    if (!instance) return

    // Cleanup
    if (instance.resizeTimeout) clearTimeout(instance.resizeTimeout)
    if (instance.resizeObserver) instance.resizeObserver.disconnect()
    instance.terminal.dispose()

    // Remove PTY subscriber
    const { [tabId]: _, ...restSubs } = st.ptySubscribers

    // Remove from state
    const { [tabId]: __, ...rest } = st.terminals
    set({ terminals: rest, ptySubscribers: restSubs })
  },

  fitTerminal: (tabId) => {
    const st = get()
    const instance = st.terminals[tabId]
    if (!instance || !instance.container) return

    try {
      // Get current terminal dimensions
      const oldCols = instance.terminal.cols
      const oldRows = instance.terminal.rows

      // Fit the terminal - this calculates and applies new dimensions
      instance.fitAddon.fit()

      const { cols, rows } = instance.terminal

      // Force xterm to update its renderer
      instance.terminal.resize(cols, rows)

      // Scroll to bottom to ensure we're showing the latest content
      instance.terminal.scrollToBottom()

      // Only resize PTY if dimensions actually changed
      if (cols !== oldCols || rows !== oldRows) {
        st.resizePty(tabId, cols, rows)
      }
    } catch (e) {
      console.error('[Terminal] fit error:', e)
    }
  },

  fitAllTerminals: (context) => {
    const st = get()
    const tabs = context === 'agent' ? st.agentTerminalTabs : st.explorerTerminalTabs
    tabs.forEach(tabId => {
      st.fitTerminal(tabId)
    })
  },

  // PTY sessions and routing
  ptyInitialized: false,
  ptySessions: {},
  ptyBySessionId: {},
  ptySubscribers: {},
  ensurePtyInfra: () => {
    const st = get()
    if (st.ptyInitialized) return
    // Global PTY event routing
    try {
      ptySvc.onData(({ sessionId, data }) => {
        const tabId = get().ptyBySessionId[sessionId]
        const sub = get().ptySubscribers[tabId]
        if (sub) sub(data)
      })
      ptySvc.onExit(({ sessionId, exitCode }) => {
        const tabId = get().ptyBySessionId[sessionId]
        const sub = get().ptySubscribers[tabId]
        if (sub) sub(`\r\n[process exited with code ${exitCode}]\r\n`)
        // Cleanup mappings but keep subscriber until component unmounts
        const { [tabId]: _, ...rest } = get().ptySessions
        const { [sessionId]: __, ...restIdx } = get().ptyBySessionId
        set({ ptySessions: rest, ptyBySessionId: restIdx })
      })
    } catch {}
    set({ ptyInitialized: true })
  },
  ensurePtySession: async (tabId, opts) => {
    const st = get()
    st.ensurePtyInfra()
    const existing = st.ptySessions[tabId]
    if (existing) return { sessionId: existing.sessionId }
    const cols = opts?.cols ?? 80
    const rows = opts?.rows ?? 24
    const context = opts?.context ?? 'explorer' // Default to explorer for backward compatibility
    try {
      const res = await ptySvc.create({ cwd: opts?.cwd, shell: opts?.shell, cols, rows })
      if (!res?.sessionId) {
        console.error('[PTY] create returned no sessionId:', res)
        throw new Error('PTY create failed: no sessionId returned')
      }
      const sessionId = res.sessionId
      const rec: PtySession = { tabId, sessionId, cols, rows, cwd: opts?.cwd, shell: opts?.shell, context }
      set({ ptySessions: { ...get().ptySessions, [tabId]: rec }, ptyBySessionId: { ...get().ptyBySessionId, [sessionId]: tabId } })
      return { sessionId }
    } catch (e: any) {
      console.error('[PTY] Failed to create session for', tabId, ':', e)
      throw e
    }
  },
  writePty: async (tabId, data) => {
    const rec = get().ptySessions[tabId]
    if (!rec) {
      console.warn('[PTY] writePty: no session for tabId', tabId)
      return { ok: false }
    }
    try {
      return await ptySvc.write(rec.sessionId, data)
    } catch (e: any) {
      console.error('[PTY] writePty failed for', tabId, ':', e)
      return { ok: false }
    }
  },
  resizePty: async (tabId, cols, rows) => {
    const rec = get().ptySessions[tabId]
    if (!rec) return { ok: false }
    try { return await ptySvc.resize(rec.sessionId, cols, rows) } catch { return { ok: false } }
  },
  disposePty: async (tabId) => {
    const rec = get().ptySessions[tabId]
    if (!rec) return { ok: true }
    try { await ptySvc.dispose(rec.sessionId) } catch {}
    const { [tabId]: _, ...rest } = get().ptySessions
    const { [rec.sessionId]: __, ...restIdx } = get().ptyBySessionId
    set({ ptySessions: rest, ptyBySessionId: restIdx })
    return { ok: true }
  },
  subscribePtyData: (tabId, fn) => {
    set({ ptySubscribers: { ...get().ptySubscribers, [tabId]: fn } })
    return () => {
      const map = { ...get().ptySubscribers }
      delete map[tabId]
      set({ ptySubscribers: map })
    }
  },


  // Session state (renamed from conversations)
  sessions: chatInitial.sessions,
  currentId: chatInitial.currentId,
  sessionsLoaded: false,

  loadSessions: async () => {
    const { sessions, currentId } = await loadSessions()
    set({ sessions, currentId, sessionsLoaded: true })
  },

  saveCurrentSession: async () => {
    const s = get()
    const current = s.sessions.find((sess) => sess.id === s.currentId)
    if (!current || !window.sessions) return

    try {
      await window.sessions.save(current)
      // Also save current session ID to localStorage
      localStorage.setItem(LS_KEYS.sessionsCurrent, current.id)
    } catch (e) {
      console.error('Failed to save session:', e)
    }
  },

  select: (id) => {
    set(() => ({ currentId: id }))
    // Save current session ID to localStorage
    localStorage.setItem(LS_KEYS.sessionsCurrent, id)
  },

  newSession: (title = 'New Chat') => {
    const session: Session = {
      id: crypto.randomUUID(),
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tokenUsage: { byProvider: {}, total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      costs: { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
    }

    // Clear all agent terminals when creating a new session
    void get().clearAgentTerminals()

    set((s) => {
      const sessions = [session, ...s.sessions]
      return { sessions, currentId: session.id }
    })
    // Save the new session immediately
    if (window.sessions) {
      window.sessions.save(session).catch(e => console.error('Failed to save new session:', e))
    }
    localStorage.setItem(LS_KEYS.sessionsCurrent, session.id)
    return session.id
  },

  rename: (id, title) => {
    set((s) => {
      const sessions = s.sessions.map((sess) => (sess.id === id ? { ...sess, title, updatedAt: Date.now() } : sess))
      return { sessions }
    })
    // Save the renamed session
    get().saveCurrentSession()
  },

  remove: async (id) => {
    set((s) => {
      const filtered = s.sessions.filter((sess) => sess.id !== id)
      const currentId = s.currentId === id ? (filtered[0]?.id ?? null) : s.currentId
      return { sessions: filtered, currentId }
    })
    // Delete the session file
    if (window.sessions) {
      try {
        await window.sessions.delete(id)
      } catch (e) {
        console.error('Failed to delete session:', e)
      }
    }
  },

  addUserMessage: (content) => {
    set((s) => {
      if (!s.currentId) return {}
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess
        const isFirst = sess.messages.length === 0
        const newTitle = isFirst && (!sess.title || sess.title === 'New Chat') ? deriveTitle(content) : sess.title
        return { ...sess, title: newTitle, messages: [...sess.messages, { role: 'user' as const, content }], updatedAt: Date.now() }
      })
      return { sessions }
    })
    // Save after user message
    get().saveCurrentSession()
  },

  addAssistantMessage: (content) => {
    set((s) => {
      if (!s.currentId) return {}
      const sessions = s.sessions.map((sess) =>
        sess.id === s.currentId ? { ...sess, messages: [...sess.messages, { role: 'assistant' as const, content }], updatedAt: Date.now() } : sess
      )
      return { sessions }
    })
    // Save after assistant message
    get().saveCurrentSession()
  },

  getCurrentMessages: () => {
    const s = get()
    const cur = s.sessions.find((sess) => sess.id === s.currentId)
    return cur?.messages ?? []
  },

  // Token usage tracking
  lastRequestTokenUsage: null,
  recordTokenUsage: (provider, model, usage) => {
    set((s) => {
      if (!s.currentId) return { lastRequestTokenUsage: { provider, model, usage } }

      // Calculate cost for this usage
      const cost = get().calculateCost(provider, model, usage)

      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.currentId) return sess

        // Update provider-specific usage
        const providerUsage = sess.tokenUsage.byProvider[provider] || { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        const newProviderUsage = {
          inputTokens: providerUsage.inputTokens + usage.inputTokens,
          outputTokens: providerUsage.outputTokens + usage.outputTokens,
          totalTokens: providerUsage.totalTokens + usage.totalTokens,
        }

        // Update total usage
        const newTotal = {
          inputTokens: sess.tokenUsage.total.inputTokens + usage.inputTokens,
          outputTokens: sess.tokenUsage.total.outputTokens + usage.outputTokens,
          totalTokens: sess.tokenUsage.total.totalTokens + usage.totalTokens,
        }

        // Update costs
        const providerCosts = sess.costs.byProviderAndModel[provider] || {}
        const modelCost = providerCosts[model] || { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }

        const newModelCost = cost ? {
          inputCost: modelCost.inputCost + cost.inputCost,
          outputCost: modelCost.outputCost + cost.outputCost,
          totalCost: modelCost.totalCost + cost.totalCost,
          currency: 'USD'
        } : modelCost

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
                [model]: newModelCost
              }
            },
            totalCost: newTotalCost,
            currency: 'USD'
          },
          updatedAt: Date.now(),
        }
      })

      return { sessions, lastRequestTokenUsage: { provider, model, usage } }
    })
    // Save after recording token usage
    get().saveCurrentSession()
  },

  // Agent metrics (main-process events)
  agentMetrics: null,
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


  // Pricing configuration
  pricingConfig: defaultPricingConfig,

  setPricingForModel: (provider, model, pricing) => {
    set((s) => ({
      pricingConfig: {
        ...s.pricingConfig,
        [provider]: {
          ...(s.pricingConfig[provider as keyof PricingConfig] as ProviderPricing),
          [model]: pricing
        },
        customRates: true
      }
    }))
  },

  resetPricingToDefaults: () => {
    set({ pricingConfig: DEFAULT_PRICING })
    localStorage.removeItem(LS_KEYS.pricing)
  },

  resetProviderPricing: (provider) => {
    set((s) => {
      const newConfig = {
        ...s.pricingConfig,
        [provider]: DEFAULT_PRICING[provider],
      }
      // Check if any provider still has custom rates
      const hasCustomRates = (['openai', 'anthropic', 'gemini'] as const).some(
        p => p !== provider &&
        JSON.stringify(newConfig[p]) !== JSON.stringify(DEFAULT_PRICING[p])
      )
      return {
        pricingConfig: {
          ...newConfig,
          customRates: hasCustomRates
        }
      }
    })
  },

  calculateCost: (provider, model, usage) => {
    const config = get().pricingConfig[provider as keyof PricingConfig]
    if (typeof config === 'boolean') return null
    const pricing = config?.[model] as ModelPricing | undefined
    if (!pricing) return null

    const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputCostPer1M
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputCostPer1M

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD'
    }
  },

  // Editor state
  openedFile: null,


	  openFile: async (filePath) => {
	    if (!window.fs) return
	    try {
	      const res = await window.fs.readFile(filePath)
	      if (res?.success && res.content) {
	        const name = filePath.split(/[/\\]/).pop() || filePath
	        const ext = name.split('.').pop()?.toLowerCase()
	        const map: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', sh: 'shell', yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql' }
	        const language = map[ext || ''] || 'plaintext'
	        set({ openedFile: { path: filePath, content: res.content, language } })
	      }
	    } catch (e) {
	      console.error('openFile failed:', e)
	    }
	  },

	  // LLM request lifecycle/streaming (centralized)
	  currentRequestId: null,
	  streamingText: '',
	  chunkStats: { count: 0, totalChars: 0 },
	  retryCount: 0,
	  llmIpcSubscribed: false,
	  ensureLlmIpcSubscription: () => {
	    const s = get(); if (s.llmIpcSubscribed) return
	    const ipc = window.ipcRenderer; if (!ipc) return
	    const onChunk = (_: any, payload: any) => {
	      const { requestId, content } = payload || {}
	      if (!requestId || requestId !== get().currentRequestId) return
	      set((st) => ({
	        streamingText: st.streamingText + (content || ''),
	        chunkStats: { count: st.chunkStats.count + 1, totalChars: st.chunkStats.totalChars + (content?.length || 0) }
	      }))
	    }
	    const onDone = () => {
	      const rid = get().currentRequestId; if (!rid) return
	      const text = get().streamingText
	      try { get().addAssistantMessage(text) } catch {}
	      // log chunk stats
	      const cs = get().chunkStats
	      if (cs.count > 0) get().addDebugLog('info', 'LLM', `Received ${cs.count} chunks (${cs.totalChars} chars total)`)
	      set({ currentRequestId: null, streamingText: '', chunkStats: { count: 0, totalChars: 0 }, retryCount: 0 })
	      get().addDebugLog('info', 'LLM', 'Stream completed')
	    }
	    const onErr = async (_: any, payload: any) => {
	      const rid = get().currentRequestId; if (!rid) return
	      const prev = get().getCurrentMessages()
	      const cs = get().chunkStats
	      set({ currentRequestId: null, streamingText: '', chunkStats: { count: 0, totalChars: 0 } })
	      if (cs.count > 0) get().addDebugLog('info', 'LLM', `Received ${cs.count} chunks (${cs.totalChars} chars total) before error`)
	      get().addDebugLog('error', 'LLM', `Error: ${payload?.error}`, { error: payload?.error })
	      const { autoRetry, selectedModel, selectedProvider } = get()
	      if (autoRetry && get().retryCount < 1) {
	        const rid2 = crypto.randomUUID()
	        set({ retryCount: get().retryCount + 1, currentRequestId: rid2 })
	        get().addDebugLog('info', 'LLM', 'Auto-retrying request')
	        const res = await window.llm?.auto?.(rid2, prev, selectedModel, selectedProvider)
	        try { get().pushRouteRecord?.({ requestId: rid2, mode: (res as any)?.mode || 'chat', provider: selectedProvider, model: selectedModel, timestamp: Date.now() }) } catch {}
	        return
	      }
	    }
	    const onToken = (_: any, payload: any) => {
	      const rid = get().currentRequestId
	      if (!rid || payload?.requestId !== rid) return
	      try { get().recordTokenUsage(payload.provider, payload.model, payload.usage) } catch {}
	      get().addDebugLog('info', 'Tokens', `Usage: ${payload.usage?.totalTokens} tokens (${payload.provider}/${payload.model})`, payload.usage)
	    }
	    ipc.on('llm:chunk', onChunk)
	    ipc.on('llm:done', onDone)
	    ipc.on('llm:error', onErr)
	    ipc.on('llm:token-usage', onToken)
	    set({ llmIpcSubscribed: true })
	  },
	  buildResponseSchemaForInput: (userText) => {
	    const isCodeChangeIntent = (t: string) => /\b(edit|change|modify|refactor|fix|update|replace)\b/i.test(t)
	    const autoEnforce = get().autoEnforceEditsSchema
	    if (!(autoEnforce && isCodeChangeIntent(userText))) return undefined
	    return {
	      name: 'edits_response',
	      schema: {
	        type: 'object',
	        additionalProperties: false,
	        properties: {
	          explanation: { type: 'string' },
	          edits: {
	            type: 'array',
	            items: {
	              type: 'object',
	              additionalProperties: false,
	              properties: {
	                type: { type: 'string', enum: ['replaceOnce', 'insertAfterLine', 'replaceRange'] },
	                path: { type: 'string' },
	                oldText: { type: 'string' },
	                newText: { type: 'string' },
	                line: { type: 'integer' },
	                start: { type: 'integer' },
	                end: { type: 'integer' },
	                text: { type: 'string' },
	              },
	              required: ['type', 'path'],
	            },
	          },
	        },
	        required: ['edits'],
	      },
	      strict: false,
	    }
	  },
	  startChatRequest: async (userText) => {
	    const { currentRequestId } = get(); if (currentRequestId) return
	    const rid = crypto.randomUUID()
	    const prev = get().getCurrentMessages()
	    const toSend = [...prev, { role: 'user' as const, content: userText }]
	    get().addUserMessage(userText)
	    set({ currentRequestId: rid, streamingText: '', chunkStats: { count: 0, totalChars: 0 }, retryCount: 0 })
	    const { selectedModel, selectedProvider } = get()
	    get().addDebugLog('info', 'LLM', `Sending request to ${selectedProvider}/${selectedModel}`, { requestId: rid, provider: selectedProvider, model: selectedModel, messageCount: toSend.length })
	    const schema = get().buildResponseSchemaForInput(userText)
	    const res = await window.llm?.auto?.(rid, toSend, selectedModel, selectedProvider, undefined, schema)
	    try { get().pushRouteRecord?.({ requestId: rid, mode: (res as any)?.mode || 'chat', provider: selectedProvider, model: selectedModel, timestamp: Date.now() }) } catch {}
	  },
	  stopCurrentRequest: async () => {
	    const rid = get().currentRequestId; if (!rid) return
	    await window.llm?.cancel?.(rid)
	    const cs = get().chunkStats
	    set({ currentRequestId: null, streamingText: '', chunkStats: { count: 0, totalChars: 0 } })
	    if (cs.count > 0) get().addDebugLog('info', 'LLM', `Received ${cs.count} chunks (${cs.totalChars} chars total) before stop`)
	    get().addDebugLog('info', 'LLM', 'Stream stopped by user')
	  },


  // Debug logging
  debugLogs: [],
  debugPanelCollapsed: false,
  setDebugPanelCollapsed: (collapsed) => set({ debugPanelCollapsed: collapsed }),
  addDebugLog: (level, category, message, data) => {
    const entry: DebugLogEntry = { timestamp: Date.now(), level, category, message, data }
    set((s) => ({ debugLogs: [entry, ...s.debugLogs].slice(0, 200) })) // Keep last 200 entries
  },
  clearDebugLogs: () => set({ debugLogs: [] }),
}), {
  name: LS_KEYS.app,
  storage: createJSONStorage(() => localStorage),
  version: 1,
  partialize: (s) => ({
    currentView: s.currentView,
    workspaceRoot: s.workspaceRoot,
    recentFolders: s.recentFolders,
    selectedModel: s.selectedModel,
    selectedProvider: s.selectedProvider,
    autoRetry: s.autoRetry,
    providerValid: s.providerValid,
    defaultModels: s.defaultModels,
    autoApproveEnabled: s.autoApproveEnabled,
    autoApproveThreshold: s.autoApproveThreshold,
    autoEnforceEditsSchema: s.autoEnforceEditsSchema,
    metaPanelOpen: s.metaPanelOpen,
    sidebarCollapsed: s.sidebarCollapsed,
    agentTerminalPanelOpen: s.agentTerminalPanelOpen,
    agentTerminalPanelHeight: s.agentTerminalPanelHeight,
    explorerTerminalPanelOpen: s.explorerTerminalPanelOpen,
    explorerTerminalPanelHeight: s.explorerTerminalPanelHeight,
    pricingConfig: s.pricingConfig,
    // Sessions are now stored in files, not in Zustand persist
  }),
  migrate: async (p: any, _v) => {
    if (!p) p = {}
    try {
      // Migrate old conversations from localStorage to session files
      const convRaw = localStorage.getItem(LS_KEYS.conversations)
      const curId = localStorage.getItem(LS_KEYS.conversationsCurrent)
      if (convRaw && window.sessions) {
        try {
          const oldConversations = JSON.parse(convRaw)
          // Convert old conversations to sessions with token usage and costs
          const sessions: Session[] = oldConversations.map((conv: any) => ({
            ...conv,
            tokenUsage: conv.tokenUsage || {
              byProvider: {},
              total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
            },
            costs: conv.costs || {
              byProviderAndModel: {},
              totalCost: 0,
              currency: 'USD'
            }
          }))

          // Save each session to a file
          await Promise.all(sessions.map(sess => window.sessions!.save(sess)))

          // Save current session ID
          if (curId) {
            localStorage.setItem(LS_KEYS.sessionsCurrent, curId)
          }

          // Clear old localStorage data
          localStorage.removeItem(LS_KEYS.conversations)
          localStorage.removeItem(LS_KEYS.conversationsCurrent)

          console.log(`Migrated ${sessions.length} conversations to session files`)
        } catch (e) {
          console.error('Failed to migrate conversations to sessions:', e)
        }
      }

      const model = localStorage.getItem(LS_KEYS.model)
      if (model && !p.selectedModel) p.selectedModel = model
      const provider = localStorage.getItem(LS_KEYS.provider)
      if (provider && !p.selectedProvider) p.selectedProvider = provider
      const view = localStorage.getItem(LS_KEYS.view)
      if (view && !p.currentView) p.currentView = view
      const folder = localStorage.getItem(LS_KEYS.folder)
      if (folder && p.workspaceRoot == null) p.workspaceRoot = folder
      const defaults = localStorage.getItem(LS_KEYS.defaultModels)
      if (defaults && !p.defaultModels) p.defaultModels = JSON.parse(defaults)
      const aae = localStorage.getItem(LS_KEYS.autoApproveEnabled)
      if (aae && p.autoApproveEnabled == null) p.autoApproveEnabled = aae === '1'
      const aat = localStorage.getItem(LS_KEYS.autoApproveThreshold)
      if (aat && p.autoApproveThreshold == null) p.autoApproveThreshold = parseFloat(aat)
      const aes = localStorage.getItem(LS_KEYS.autoEnforceEditsSchema)
      if (aes && p.autoEnforceEditsSchema == null) p.autoEnforceEditsSchema = aes === '1'
    } catch {}
    return p
  },
}))


// Dev/test helper: expose store on window for automation
try { if (typeof window !== 'undefined') { (window as any).__appStore = useAppStore } } catch {}

