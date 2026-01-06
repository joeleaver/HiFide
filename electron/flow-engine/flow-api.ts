/**
 * Flow API - Standardized interface for nodes to communicate with the flow system
 * 
 * This provides all the infrastructure nodes need without coupling them to
 * implementation details. All nodes receive the same FlowAPI instance for
 * a given execution, but may receive different contexts.
 */

import type { ContextManager } from './contextManager'
import type { EmitExecutionEvent } from './execution-events'
import type { MainFlowContext, MessagePart } from './types'
import type { CreateIsolatedContextOptions } from './context-options'

export type { CreateIsolatedContextOptions } from './context-options'

/**
 * Badge for conversation UI
 */
export interface Badge {
  type: 'info' | 'success' | 'warning' | 'error'
  label: string
  icon?: string
  color?: string
  variant?: 'light' | 'filled' | 'outline'
  status?: 'pending' | 'success' | 'error'
}

/**
 * Tool definition
 */
export interface Tool {
  name: string
  description: string
  parameters: Record<string, any>
}

/**
 * Usage reporting for LLM calls
 */
export interface UsageReport {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  // Cost is calculated by the API layer based on provider/model pricing
}

/**
 * Flow API - provided to all nodes
 */
export interface FlowAPI {
  // ===== Identity =====

  /**
   * Unique identifier for this node instance
   */
  nodeId: string

  /**
   * Unique identifier for this flow execution
   */
  requestId: string

  /**
   * Unique identifier for this specific node execution
   * Generated each time the node executes (even if same node executes multiple times)
   */
  executionId: string

  /**
   * Optional workspace identifier (absolute path) that this flow is scoped to
   */
  workspaceId?: string

  // ===== Cancellation =====

  /**
   * Abort signal for cancellation
   * Nodes can check signal.aborted or listen to 'abort' event
   */
  signal: AbortSignal

  /**
   * Check if execution has been cancelled
   * Throws an error if cancelled
   * Long-running nodes should call this periodically
   */
  checkCancelled: () => void

  // ===== Store Access =====

  /**
   * DEPRECATED: Store access removed - use ServiceRegistry instead
   * Nodes should use services for state management
   */
  store: any  // Legacy field - no longer used

  // ===== Context Management =====
  
  /**
   * Context management API for the active context (main or isolated).
   * Nodes should treat the `context` argument as read-only and use this
   * manager for mutations to guarantee single-writer semantics.
   */
  context: ContextManager

  /**
   * Helpers for working with multiple contexts registered to the scheduler.
   */
  contexts: {
    /** Snapshot of the currently bound context */
    active: () => MainFlowContext
    /** All known contexts */
    list: () => MainFlowContext[]
    /** Lookup a context by ID */
    get: (contextId: string) => MainFlowContext | undefined
    /** Create a new isolated context managed by the scheduler */
    createIsolated: (options: CreateIsolatedContextOptions) => MainFlowContext
    /** Release an isolated context once it is no longer needed */
    release: (contextId: string) => boolean
  }

  // ===== Conversation Updates =====
  
  conversation: {
    /**
     * Stream a chunk of text to the conversation UI
     * Used by LLM nodes for real-time streaming
     */
    streamChunk: (chunk: string) => void
    
    /**
     * Add a badge to the conversation
     * Returns the badge ID for later updates
     */
    addBadge: (badge: Badge) => string
    
    /**
     * Update an existing badge
     */
    updateBadge: (badgeId: string, updates: Partial<Badge>) => void
  }

  // ===== Logging & Debugging =====
  
  log: {
    /**
     * Log debug message to flow debug window
     */
    debug: (message: string, data?: any) => void
    
    /**
     * Log info message to flow debug window
     */
    info: (message: string, data?: any) => void
    
    /**
     * Log warning message to flow debug window
     */
    warn: (message: string, data?: any) => void
    
    /**
     * Log error message to flow debug window
     */
    error: (message: string, data?: any) => void
  }

  // ===== Tool Execution =====
  
  tools: {
    /**
     * Execute a tool by name with arguments
     * Returns the tool result
     */
    execute: (toolName: string, args: any) => Promise<any>
    
    /**
     * Get list of available tools
     */
    list: () => Tool[]
  }

  // ===== Usage & Cost Reporting =====
  
  usage: {
    /**
     * Report token usage for an LLM call
     * The API layer will calculate cost based on provider/model pricing
     * and update session totals
     */
    report: (usage: UsageReport) => void
  }

  // ===== User Input =====

  /**
   * Wait for user to provide input
   * Used by userInput node to break loops naturally
   * Sets flow status to 'waitingForInput' and waits for user submission
   * 
   * @param prompt - Optional message to display to the user
   */
  waitForUserInput: (prompt?: string) => Promise<string | MessagePart[]>

  // ===== Portal Nodes =====

  /**
   * Trigger all Portal Output nodes with matching ID
   * Used by Portal Input nodes to push data through portals
   */
  triggerPortalOutputs: (portalId: string) => Promise<void>

  /**
   * Store data in portal registry
   * Used by Portal Input nodes to store context/data for Portal Output nodes
   */
  setPortalData: (portalId: string, context?: any, data?: any) => void

  /**
   * Retrieve data from portal registry
   * Used by Portal Output nodes to retrieve context/data stored by Portal Input nodes
   */
  getPortalData: (portalId: string) => { context?: any; data?: any } | undefined

  // ===== Execution Events =====

  /**
   * Emit an execution event
   *
   * This is the unified event system for all execution events (chunks, tool calls, usage, etc.)
   * Providers and nodes emit events here, and FlowAPI routes them to the appropriate handlers.
   *
   * Benefits:
   * - Decouples providers from presentation logic
   * - Single source of truth for execution metadata
   * - Easy to add new event types
   * - Better debugging and logging
   *
   * @param event - Execution event (executionId, nodeId, timestamp will be added automatically)
   */
  emitExecutionEvent: EmitExecutionEvent
}
