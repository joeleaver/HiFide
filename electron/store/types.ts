/**
 * Shared types for the application store
 *
 * This file contains all type definitions used across multiple store slices.
 */

// ============================================================================
// View Types
// ============================================================================

export type ViewType = 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings'

// ============================================================================
// Chat/Session Types
// ============================================================================

// Badge system for inline timeline display
export type BadgeType =
  | 'intent'      // Intent router classification
  | 'tool'        // Tool execution
  | 'cache'       // Cache hit
  | 'fileEdit'    // File edit (future: interactive diff)
  | 'error'       // Error badge
  | 'custom'      // Custom badge

export type Badge = {
  id: string                    // Unique ID for this badge
  type: BadgeType
  timestamp: number
  nodeId?: string               // Which flow node created this badge

  // Badge-specific data
  label: string                 // Display text (may include context like filename)
  icon?: string                 // Emoji or icon
  color?: string                // Badge color (mantine color name)
  variant?: 'light' | 'filled'  // Badge style

  // Tool-specific data (for matching when updating status)
  toolName?: string             // Original tool name (e.g., 'fs_read_file') for tool badges

  // Interactive badge data (future)
  interactive?: {
    type: 'diff' | 'link' | 'action'
    data: any
  }

  // Status (for tool badges)
  status?: 'running' | 'success' | 'error'
  error?: string
}

// Session items represent the chronological timeline of a session
// This allows badges to appear inline with messages
export type SessionItem =
  | SessionMessage
  | SessionBadgeGroup

export type SessionMessage = {
  type: 'message'
  id: string                    // Unique ID for this message
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  nodeId?: string               // Which node created this message (for grouping with badges)
  nodeLabel?: string            // Display name of the node that generated this
  nodeKind?: string             // Kind of node (for color matching)

  // Metadata about this message
  provider?: string             // Which provider generated this
  model?: string                // Which model generated this
  tokenUsage?: TokenUsage       // Token usage for this message
  cost?: TokenCost              // Cost for this message
}

export type SessionBadgeGroup = {
  type: 'badge-group'
  id: string                    // Unique ID for this badge group
  nodeId?: string               // Which node created these badges
  nodeLabel?: string            // Display name of the node
  nodeKind?: string             // Kind of node (for color matching)
  timestamp: number
  badges: Badge[]               // Badges in this group

  // Metadata (optional)
  provider?: string             // Which provider was used
  model?: string                // Which model was used
  cost?: TokenCost              // Cost for this node execution
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number  // Tokens served from cache (Gemini context caching)
}

export type TokenCost = {
  inputCost: number
  outputCost: number
  totalCost: number
  currency: string  // 'USD'
  cachedInputCost?: number  // Cost of cached tokens (if applicable)
  savings?: number          // Amount saved from caching
  savingsPercent?: number   // Percentage saved from caching
}

export type Session = {
  id: string
  title: string
  items: SessionItem[]          // Chronological timeline of messages and badges
  createdAt: number
  updatedAt: number
  lastActivityAt: number        // Last user/assistant interaction

  // Current session context
  currentContext: {
    provider: string
    model: string
    systemInstructions?: string
    temperature?: number
  }

  // Flow state - which flow is being used and its current state
  lastUsedFlow?: string  // Flow template ID (e.g., 'default', 'user/my-flow')
  flowState?: {
    requestId: string  // Current flow execution requestId
    status: 'stopped' | 'running' | 'waitingForInput'
    pausedAt?: number   // Timestamp when flow was paused (waitingForInput)
    pausedNodeId?: string  // Which node the flow is paused at (waitingForInput)
  }

  // Flow debug logs - execution events for this session
  flowDebugLogs?: Array<{
    requestId: string
    type: 'nodeStart' | 'nodeEnd' | 'io' | 'done' | 'error' | 'waitingForInput' | 'chunk' | 'toolStart' | 'toolEnd' | 'toolError' | 'intentDetected' | 'tokenUsage'
    nodeId?: string
    data?: any
    error?: string
    durationMs?: number
    timestamp: number
    text?: string  // For chunk events
    toolName?: string  // For tool events
    callId?: string  // For tool events
    intent?: string  // For intentDetected events
    provider?: string  // For tokenUsage events
    model?: string  // For tokenUsage events
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number }  // For tokenUsage events
  }>

  // Token usage and costs
  tokenUsage: {
    byProvider: Record<string, TokenUsage>
    total: TokenUsage
  }
  costs: {
    byProviderAndModel: Record<string, Record<string, TokenCost>>  // provider -> model -> cost
    totalCost: number
    currency: string
  }

  // Provider-specific conversation metadata (optional)
  conversationState?: Record<string, {
    conversationId?: string
    lastResponseId?: string
    preambleHash?: string
    lastSystemPrompt?: string
    lastToolsHash?: string
  }>
}

// ============================================================================
// Terminal/PTY Types
// ============================================================================

export type PtySession = {
  tabId: string
  sessionId: string
  cols: number
  rows: number
  cwd?: string
  shell?: string
  context: 'agent' | 'explorer'
}

// NOTE: TerminalInstance type moved to src/services/terminalInstances.ts
// to keep non-serializable objects out of the store

// ============================================================================
// Planning Types
// ============================================================================

export type PlanStep = {
  id: string
  title: string
  kind?: string
  targets?: string[]
  actions?: any[]
  verify?: any[]
  rollback?: any[]
  dependencies?: string[]
}

export type ApprovedPlan = {
  goals?: string[]
  constraints?: string[]
  assumptions?: string[]
  risks?: string[]
  steps: PlanStep[]
  autoApproveEnabled?: boolean
  autoApproveThreshold?: number
}

// ============================================================================
// Indexing Types
// ============================================================================

export type IndexStatus = {
  ready: boolean
  chunks: number
  modelId?: string
  dim?: number
  indexPath: string
}

export type IndexProgress = {
  inProgress?: boolean
  phase?: string
  processedFiles?: number
  totalFiles?: number
  processedChunks?: number
  totalChunks?: number
  elapsedMs?: number
}

// ============================================================================
// Model/Provider Types
// ============================================================================

export type ModelOption = {
  value: string
  label: string
}

export type RouteRecord = {
  requestId: string
  mode: 'chat' | 'tools' | 'plan'
  provider: string
  model: string
  timestamp: number
}

// ============================================================================
// Pricing Types
// ============================================================================

export type ModelPricing = {
  inputCostPer1M: number
  outputCostPer1M: number
  cachedInputCostPer1M?: number  // Cost per 1M cached input tokens (for Gemini context caching)
}

export type ProviderPricing = Record<string, ModelPricing>

export type PricingConfig = {
  openai: ProviderPricing
  anthropic: ProviderPricing
  gemini: ProviderPricing
  customRates?: boolean
}

// ============================================================================
// Rate Limit Types
// ============================================================================

export type RateLimitKind = {
  rpm?: number
  tpmTotal?: number
  tpmInput?: number
  tpmOutput?: number
  maxConcurrent?: number
}

export type RateLimitConfig = {
  enabled: boolean
  openai?: Record<string, RateLimitKind>
  anthropic?: Record<string, RateLimitKind>
  gemini?: Record<string, RateLimitKind>
}

// ============================================================================
// Activity/Badge Types
// ============================================================================

export type ActivityEvent = {
  kind: 'ToolStarted' | 'ToolProgress' | 'ToolCompleted' | 'ToolFailed' | 'FileEditApplied'
  opId?: string
  tool?: string
  summary?: string
  error?: string
  files?: string[]
  timestamp?: number
}

// ============================================================================
// Debug Types
// ============================================================================

export type DebugLogEntry = {
  timestamp: number
  level: 'info' | 'warning' | 'error'
  category: string
  message: string
  data?: any
}

// ============================================================================
// Workspace Types
// ============================================================================

export type RecentFolder = {
  path: string
  lastOpened: number
}

export type FileWatchEvent = {
  path: string
  type: 'rename' | 'change'
  timestamp: number
}

export type ContextRefreshResult = {
  ok: boolean
  createdPublic?: boolean
  createdPrivate?: boolean
  ensuredGitIgnore?: boolean
  generatedContext?: boolean
  error?: string
}

// ============================================================================
// Explorer Types
// ============================================================================

export type ExplorerEntry = {
  name: string
  isDirectory: boolean
  path: string
}

export type OpenedFile = {
  path: string
  content: string
  language: string
}

// ============================================================================
// Settings Types
// ============================================================================

export type ApiKeys = {
  openai: string
  anthropic: string
  gemini: string
}

// ============================================================================
// Agent Metrics Types
// ============================================================================

export type AgentMetrics = {
  requestId: string
  tokensUsed: number
  tokenBudget: number
  iterationsUsed: number
  maxIterations: number
  percentageUsed: number
}

