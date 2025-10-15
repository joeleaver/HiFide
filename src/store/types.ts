/**
 * Shared types for the application store
 * 
 * This file contains all type definitions used across multiple store slices.
 */

import type { Terminal } from 'xterm'
import type { FitAddon } from 'xterm-addon-fit'

// ============================================================================
// View Types
// ============================================================================

export type ViewType = 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings'

// ============================================================================
// Chat/Session Types
// ============================================================================

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]  // Tool calls that happened before this message
  intent?: string  // Detected intent for this message (from intent router)
}

export type ToolCall = {
  toolName: string
  timestamp: number
  status: 'running' | 'success' | 'error'
  error?: string
}

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

export type Session = {
  id: string
  title: string
  messages: ChatMessage[]
  toolCalls: ToolCall[]  // Log of all tool calls in this session
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
  // Flow state - which flow is being used and its current state
  lastUsedFlow?: string  // Flow template ID (e.g., 'default', 'user/my-flow')
  flowState?: {
    requestId: string  // Current flow execution requestId
    pausedAt: number   // Timestamp when flow was paused
    pausedNodeId?: string  // Which node the flow is paused at
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

export type TerminalInstance = {
  terminal: Terminal
  fitAddon: FitAddon
  container: HTMLElement | null
  resizeObserver: ResizeObserver | null
  resizeTimeout: NodeJS.Timeout | null
}

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

