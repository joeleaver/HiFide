# Phase 2: Slice Specifications

Detailed specifications for each store slice.

---

## 1. View Slice (`view.slice.ts`)

**Responsibility:** Manage current application view

**State:**
```typescript
{
  currentView: ViewType  // 'agent' | 'explorer' | 'flowEditor' | 'sourceControl' | 'terminal' | 'settings'
}
```

**Actions:**
```typescript
setCurrentView: (view: ViewType) => void
```

**Dependencies:** None

**Persistence:** Yes (`currentView`)

**Estimated Lines:** ~30

---

## 2. UI Slice (`ui.slice.ts`)

**Responsibility:** Manage UI panel states

**State:**
```typescript
{
  metaPanelOpen: boolean
  sidebarCollapsed: boolean
  debugPanelCollapsed: boolean
  agentTerminalPanelOpen: boolean
  agentTerminalPanelHeight: number
  explorerTerminalPanelOpen: boolean
  explorerTerminalPanelHeight: number
}
```

**Actions:**
```typescript
setMetaPanelOpen: (open: boolean) => void
setSidebarCollapsed: (collapsed: boolean) => void
setDebugPanelCollapsed: (collapsed: boolean) => void
setAgentTerminalPanelOpen: (open: boolean) => void
setAgentTerminalPanelHeight: (h: number) => void
setExplorerTerminalPanelOpen: (open: boolean) => void
toggleExplorerTerminalPanel: () => void
setExplorerTerminalPanelHeight: (h: number) => void
```

**Dependencies:** None

**Persistence:** Partial (panel states)

**Estimated Lines:** ~80

---

## 3. Debug Slice (`debug.slice.ts`)

**Responsibility:** Manage debug logs

**State:**
```typescript
{
  debugLogs: DebugLogEntry[]
}
```

**Actions:**
```typescript
addDebugLog: (level: 'info' | 'warning' | 'error', category: string, message: string, data?: any) => void
clearDebugLogs: () => void
```

**Dependencies:** None

**Persistence:** No

**Estimated Lines:** ~60

---

## 4. Planning Slice (`planning.slice.ts`)

**Responsibility:** Manage approved plans and execution

**State:**
```typescript
{
  approvedPlan: ApprovedPlan | null
}
```

**Actions:**
```typescript
setApprovedPlan: (p: ApprovedPlan | null) => void
saveApprovedPlan: () => Promise<{ ok: boolean } | undefined>
loadApprovedPlan: () => Promise<{ ok: boolean } | undefined>
executeApprovedPlanAutonomous: () => Promise<void>
executeApprovedPlanFirstStep: () => Promise<void>
```

**Dependencies:** 
- Session slice (for adding messages)
- Provider slice (for model/provider)

**Persistence:** Via IPC (not localStorage)

**Estimated Lines:** ~120

---

## 5. App Slice (`app.slice.ts`)

**Responsibility:** App initialization and bootstrap

**State:**
```typescript
{
  appBootstrapping: boolean
  startupMessage: string | null
}
```

**Actions:**
```typescript
initializeApp: () => Promise<void>
setStartupMessage: (msg: string | null) => void
```

**Dependencies:**
- Workspace slice (for folder initialization)
- Session slice (for session loading)
- Provider slice (for model loading)
- Settings slice (for API key loading)

**Persistence:** No

**Estimated Lines:** ~100

---

## 6. Workspace Slice (`workspace.slice.ts`)

**Responsibility:** Workspace folder management

**State:**
```typescript
{
  workspaceRoot: string | null
  recentFolders: Array<{ path: string; lastOpened: number }>
  fileWatchCleanup: (() => void) | null
  fileWatchEvent: { path: string; type: 'rename' | 'change'; timestamp: number } | null
  ctxRefreshing: boolean
  ctxResult: { ok: boolean; createdPublic?: boolean; createdPrivate?: boolean; ensuredGitIgnore?: boolean; generatedContext?: boolean; error?: string } | null
}
```

**Actions:**
```typescript
setWorkspaceRoot: (folder: string | null) => void
addRecentFolder: (path: string) => void
clearRecentFolders: () => void
openFolder: (folderPath: string) => Promise<{ ok: boolean; error?: string }>
hasUnsavedChanges: () => boolean
refreshContext: () => Promise<void>
```

**Dependencies:**
- Explorer slice (for clearing explorer state)
- Indexing slice (for rebuilding index)

**Persistence:** Yes (`workspaceRoot`, `recentFolders`)

**Estimated Lines:** ~200

---

## 7. Explorer Slice (`explorer.slice.ts`)

**Responsibility:** File explorer tree state

**State:**
```typescript
{
  explorerOpenFolders: Set<string>
  explorerChildrenByDir: Record<string, Array<{ name: string; isDirectory: boolean; path: string }>>
  openedFile: { path: string; content: string; language: string } | null
}
```

**Actions:**
```typescript
loadExplorerDir: (dirPath: string) => Promise<void>
toggleExplorerFolder: (dirPath: string) => Promise<void>
openFile: (path: string) => Promise<void>
```

**Dependencies:**
- Workspace slice (for workspace root)

**Persistence:** No

**Estimated Lines:** ~150

---

## 8. Indexing Slice (`indexing.slice.ts`)

**Responsibility:** Code indexing and search

**State:**
```typescript
{
  idxStatus: IndexStatus | null
  idxLoading: boolean
  idxQuery: string
  idxResults: Array<{ path: string; startLine: number; endLine: number; text: string }>
  idxProg: IndexProgress | null
}
```

**Actions:**
```typescript
ensureIndexProgressSubscription: () => void
refreshIndexStatus: () => Promise<void>
rebuildIndex: () => Promise<{ ok: boolean; status?: IndexStatus | null; error?: unknown } | undefined>
clearIndex: () => Promise<{ ok: boolean } | undefined>
setIdxQuery: (q: string) => void
searchIndex: () => Promise<void>
```

**Dependencies:**
- Workspace slice (for workspace root)

**Persistence:** No

**Estimated Lines:** ~180

---

## 9. Provider Slice (`provider.slice.ts`)

**Responsibility:** LLM provider and model selection

**State:**
```typescript
{
  selectedModel: string
  selectedProvider: string
  autoRetry: boolean
  providerValid: Record<string, boolean>
  modelsByProvider: Record<string, ModelOption[]>
  defaultModels: Record<string, string>
  routeHistory: RouteRecord[]
}
```

**Actions:**
```typescript
setSelectedModel: (m: string) => void
setSelectedProvider: (p: string) => void
setAutoRetry: (v: boolean) => void
ensureProviderModelConsistency: () => void
setProviderValid: (provider: string, valid: boolean) => void
setProvidersValid: (map: Record<string, boolean>) => void
setModelsForProvider: (provider: string, models: ModelOption[]) => void
refreshModels: (provider: 'openai' | 'anthropic' | 'gemini') => Promise<void>
refreshAllModels: () => Promise<void>
setDefaultModel: (provider: string, model: string) => void
pushRouteRecord: (r: RouteRecord) => void
```

**Dependencies:** None

**Persistence:** Yes (`selectedModel`, `selectedProvider`, `defaultModels`)

**Estimated Lines:** ~350

---

## 10. Settings Slice (`settings.slice.ts`)

**Responsibility:** Application settings

**State:**
```typescript
{
  // API Keys
  settingsApiKeys: { openai: string; anthropic: string; gemini: string }
  settingsSaving: boolean
  settingsSaved: boolean
  
  // Auto-approve
  autoApproveEnabled: boolean
  autoApproveThreshold: number
  
  // Agent behavior
  autoEnforceEditsSchema: boolean
  
  // Pricing
  pricingConfig: PricingConfig
  
  // Rate limits
  rateLimitConfig: RateLimitConfig
}
```

**Actions:**
```typescript
// API Keys
setSettingsApiKey: (provider: 'openai' | 'anthropic' | 'gemini', value: string) => void
loadSettingsApiKeys: () => Promise<void>
saveSettingsApiKeys: () => Promise<{ ok: boolean; failures: string[] }>
resetSettingsSaved: () => void

// Auto-approve
setAutoApproveEnabled: (v: boolean) => void
setAutoApproveThreshold: (v: number) => void

// Agent behavior
setAutoEnforceEditsSchema: (v: boolean) => void

// Pricing
setPricingForModel: (provider: string, model: string, pricing: ModelPricing) => void
resetPricingToDefaults: () => void
resetProviderPricing: (provider: 'openai' | 'anthropic' | 'gemini') => void
calculateCost: (provider: string, model: string, usage: TokenUsage) => TokenCost | null

// Rate limits
setRateLimitForModel: (provider: 'openai'|'anthropic'|'gemini', model: string, limits: RateLimitKind) => Promise<void>
toggleRateLimiting: (enabled: boolean) => Promise<void>
loadRateLimitConfig: () => Promise<void>
saveRateLimitConfig: () => Promise<void>
```

**Dependencies:**
- Provider slice (for validation after API key save)

**Persistence:** Yes (all settings)

**Estimated Lines:** ~400

---

## 11. Terminal Slice (`terminal.slice.ts`)

**Responsibility:** Terminal and PTY management

**State:**
```typescript
{
  // Terminal tabs
  agentTerminalTabs: string[]
  agentActiveTerminal: string | null
  explorerTerminalTabs: string[]
  explorerActiveTerminal: string | null
  agentSessionTerminals: Record<string, string[]>
  
  // Terminal instances
  terminals: Record<string, TerminalInstance>
  
  // PTY sessions
  ptyInitialized: boolean
  ptySessions: Record<string, PtySession>
  ptyBySessionId: Record<string, string>
  ptySubscribers: Record<string, (data: string) => void | undefined>
}
```

**Actions:**
```typescript
// Terminal tabs
addTerminalTab: (context: 'agent' | 'explorer') => string
removeTerminalTab: (context: 'agent' | 'explorer', tabId: string) => void
setActiveTerminal: (context: 'agent' | 'explorer', tabId: string | null) => void
clearAgentTerminals: () => Promise<void>
clearExplorerTerminals: () => Promise<void>

// Terminal instances
mountTerminal: (tabId: string, container: HTMLElement, context: 'agent' | 'explorer') => Promise<void>
remountTerminal: (tabId: string, container: HTMLElement) => void
unmountTerminal: (tabId: string) => void
fitTerminal: (tabId: string) => void
fitAllTerminals: (context: 'agent' | 'explorer') => void

// PTY sessions
ensurePtyInfra: () => void
ensurePtySession: (tabId: string, opts?: { cwd?: string; shell?: string; cols?: number; rows?: number; context?: 'agent' | 'explorer' }) => Promise<{ sessionId: string }>
writePty: (tabId: string, data: string) => Promise<{ ok: boolean }>
resizePty: (tabId: string, cols: number, rows: number) => Promise<{ ok: boolean }>
disposePty: (tabId: string) => Promise<{ ok: boolean }>
subscribePtyData: (tabId: string, fn: (data: string) => void) => () => void
```

**Dependencies:**
- Workspace slice (for cwd)

**Persistence:** No

**Estimated Lines:** ~500

---

## 12. Session Slice (`session.slice.ts`)

**Responsibility:** Chat sessions and LLM requests

**State:**
```typescript
{
  // Sessions
  sessions: Session[]
  currentId: string | null
  sessionsLoaded: boolean
  
  // LLM request lifecycle
  currentRequestId: string | null
  streamingText: string
  chunkStats: { count: number; totalChars: number }
  retryCount: number
  llmIpcSubscribed: boolean
  doneByRequestId: Record<string, boolean>
  
  // Token usage
  lastRequestTokenUsage: { provider: string; model: string; usage: TokenUsage } | null
  lastRequestSavings: { provider: string; model: string; approxTokensAvoided: number } | null
  
  // Agent metrics
  agentMetrics: { requestId: string; tokensUsed: number; tokenBudget: number; iterationsUsed: number; maxIterations: number; percentageUsed: number } | null
  
  // Activity
  activityByRequestId: Record<string, ActivityEvent[]>
}
```

**Actions:**
```typescript
// Sessions
loadSessions: () => Promise<void>
ensureSessionPresent: () => void
saveCurrentSession: () => Promise<void>
select: (id: string) => void
newSession: (title?: string) => string
rename: (id: string, title: string) => void
remove: (id: string) => void
addUserMessage: (content: string) => void
addAssistantMessage: (content: string) => void
getCurrentMessages: () => ChatMessage[]

// LLM requests
ensureLlmIpcSubscription: () => void
buildResponseSchemaForInput: (userText: string) => any | undefined
startChatRequest: (userText: string) => Promise<void>
stopCurrentRequest: () => Promise<void>

// Token usage
recordTokenUsage: (provider: string, model: string, usage: TokenUsage) => void

// Agent metrics
ensureAgentMetricsSubscription: () => void

// Activity
getActivityForRequest: (requestId: string) => ActivityEvent[]
```

**Dependencies:**
- Provider slice (for model/provider)
- Settings slice (for pricing, auto-approve)
- Planning slice (for approved plan)

**Persistence:** Partial (sessions via IPC)

**Estimated Lines:** ~400

---

## Cross-Slice Communication Patterns

### Pattern 1: Direct Access
```typescript
// In slice A, access slice B's state
const createSliceA = (set, get) => ({
  someAction: () => {
    const sliceBValue = get().sliceBField
    // use sliceBValue
  }
})
```

### Pattern 2: Callbacks
```typescript
// In slice A, call slice B's action
const createSliceA = (set, get) => ({
  someAction: () => {
    get().sliceBAction()
  }
})
```

### Pattern 3: Subscriptions
```typescript
// In component, subscribe to multiple slices
const value1 = useAppStore(state => state.slice1Value)
const value2 = useAppStore(state => state.slice2Value)
```

---

## Testing Strategy

Each slice should have:
1. **Unit tests** - Test actions in isolation
2. **Integration tests** - Test cross-slice interactions
3. **Persistence tests** - Test localStorage integration

Example test structure:
```typescript
describe('ViewSlice', () => {
  it('should set current view', () => {
    const store = createTestStore()
    store.getState().setCurrentView('settings')
    expect(store.getState().currentView).toBe('settings')
  })
})
```

