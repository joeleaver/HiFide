/**
 * Flow Execution Engine V2 - Type Definitions
 * 
 * Clean, function-based execution with explicit inputs/outputs
 */

/**
 * MainFlowContext - Pure conversation state passed through the flow
 *
 * This is the essential conversation state that nodes need to maintain
 * conversation continuity. It contains only what's needed to continue
 * a conversation with an LLM - no internal plumbing or scheduler state.
 *
 * This type will be used later when we support multiple disconnected contexts.
 */
export interface MainFlowContext {
  /**
   * Unique identifier for this context (e.g., 'main', or a newContext node ID)
   * Multiple nodes can share the same context to maintain conversation continuity.
   */
  contextId: string

  /**
   * Context type - determines visual styling and behavior
   * - 'main': The primary conversation context (purple handles)
   * - 'isolated': A separate context created by newContext node (teal handles)
   */
  contextType?: 'main' | 'isolated'

  /**
   * AI provider for this context (e.g., 'openai', 'anthropic', 'gemini')
   * Determines which LLM API to use.
   */
  provider: string

  /**
   * Model identifier (e.g., 'gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro')
   * Specific model within the provider to use.
   */
  model: string

  /**
   * Optional system instructions for this context
   * Corresponds to developer message in GPT (may differ in other models).
   * Sent to guide the LLM's behavior.
   */
  systemInstructions?: string

  /**
   * Conversation history for this context
   * Shared across all nodes using the same contextId.
   * Contains the full conversation between user and assistant.
   */
  messageHistory: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string

    /**
     * Optional metadata for message management and context windowing
     */
    metadata?: {
      /**
       * Unique identifier for this message (auto-generated)
       * Used for idempotent message injection and updates
       */
      id: string

      /**
       * If true, this message is pinned to the top during context windowing
       * Pinned messages maintain their relative order
       */
      pinned?: boolean

      /**
       * Priority for pinned messages (higher = more important)
       * When windowing needs to remove pinned messages, lower priority goes first
       * Default: 50
       */
      priority?: number
    }
  }>
}

/**
 * @deprecated Use MainFlowContext instead
 * Kept temporarily for backwards compatibility during refactor
 */
export type ExecutionContext = MainFlowContext & {
  sessionId: string
  currentOutput: string
  _requestId?: string
}

/**
 * NodeOutput - What a node returns after execution
 *
 * IMPORTANT: Output field names MUST match handle names exactly.
 * - 'context' field → flows through 'context' handle
 * - 'data' field → flows through 'data' handle
 * - 'tools' field → flows through 'tools' handle
 *
 * No mapping is performed - the scheduler uses field names directly.
 */
export interface NodeOutput {
  /**
   * Context output - ALWAYS present
   * The updated main flow context after this node runs.
   * Flows through 'context' handle.
   *
   * Every node must output context, even if unchanged.
   */
  context: MainFlowContext

  /**
   * Data output - OPTIONAL
   * Simple data values produced by this node.
   * Examples:
   * - userInput node: the user's message string
   * - llmRequest node: the assistant's response string
   *
   * Flows through 'data' handle.
   */
  data?: any

  /**
   * Tools output - OPTIONAL
   * Array of tool definitions for LLM Request nodes.
   * Only used by tools node.
   * Flows through 'tools' handle.
   */
  tools?: any[]

  /**
   * Optional execution metadata
   * Used for debugging, logging, and monitoring
   */
  metadata?: {
    durationMs?: number
    tokenUsage?: { input: number; output: number }
    cached?: boolean
    [key: string]: any
  }

  /**
   * Execution status
   * - 'success': Node completed successfully
   * - 'paused': Node paused execution (e.g., userInput waiting for user)
   * - 'error': Node encountered an error
   */
  status: 'success' | 'paused' | 'error'

  /**
   * Error message if status is 'error'
   */
  error?: string
}

/**
 * Node inputs - lazy pull interface
 *
 * Nodes control when they pull from connected inputs.
 * This enables lazy evaluation and conditional pulling (e.g., cache nodes).
 */
export interface NodeInputs {
  /**
   * Pull a value from a connected input
   * Executes the source node if needed and returns the value
   */
  pull: (inputName: string) => Promise<any>

  /**
   * Check if an input was pushed (vs needs to be pulled)
   * Returns true if the input was provided via push
   */
  has: (inputName: string) => boolean
}

/**
 * NodeFunction - The signature for all node implementations
 *
 * Nodes receive:
 * 1. flow: FlowAPI instance for system communication (same for all nodes)
 * 2. context: Main flow context (different per node, can have multiple contexts per flow)
 * 3. dataIn: Simple data value pushed from predecessor (undefined if pulled)
 * 4. inputs: Lazy pull interface for connected inputs
 * 5. config: Node-specific configuration
 *
 * Nodes are autonomous functions that:
 * - Control when they pull inputs (lazy evaluation)
 * - Decide when they're "done" (different logic per node type)
 * - Call successors when complete (via return value)
 * - Communicate with system via FlowAPI (logging, badges, streaming, etc.)
 */
export type NodeFunction = (
  flow: import('./flow-api').FlowAPI,
  context: MainFlowContext,
  dataIn: any | undefined,
  inputs: NodeInputs,
  config: Record<string, any>
) => Promise<NodeOutput>

/**
 * Edge - Explicit connection between node outputs and inputs
 */
export interface Edge {
  id: string
  source: string // Source node ID
  sourceOutput: string // Output name from source node (e.g., 'result', 'tools', 'context')
  sourceHandle?: string // Original handle name (for compatibility)
  target: string // Target node ID
  targetInput: string // Input name for target node (e.g., 'message', 'tools', 'data')
  targetHandle?: string // Original handle name (for compatibility)
  
  /**
   * Optional metadata for special edge types
   */
  metadata?: {
    isContextEdge?: boolean // True if this edge propagates execution context
    [key: string]: any
  }
}

/**
 * Execution policy for a node
 * - 'any': Execute when ANY input is ready (OR logic) - default for most nodes
 * - 'all': Execute when ALL inputs are ready (AND logic) - for joins/collect nodes
 * - 'custom': Node function decides when it's ready via canExecute callback
 */
export type NodeExecutionPolicy = 'any' | 'all' | 'custom'

/**
 * Whether a node can execute multiple times in a flow
 * - true: Node can execute multiple times (e.g., userInput in a loop)
 * - false: Node executes once and is memoized (default)
 */
export type NodeReExecutable = boolean

/**
 * Node definition in the flow
 */
export interface FlowNode {
  id: string
  type: string // Node type (e.g., 'llmRequest', 'userInput', 'tools')
  config?: Record<string, any> // Node-specific configuration
  position?: { x: number; y: number } // UI position
  data?: any // Additional data
  executionPolicy?: NodeExecutionPolicy // How to determine if node is ready
  reExecutable?: NodeReExecutable // Whether node can execute multiple times
}

/**
 * Flow definition
 */
export interface FlowDefinition {
  nodes: FlowNode[]
  edges: Edge[]
  metadata?: {
    name?: string
    description?: string
    version?: string
    [key: string]: any
  }
}

/**
 * Flow execution arguments
 */
export interface FlowExecutionArgs {
  requestId: string
  flowDef: FlowDefinition
  input?: string
  sessionId?: string
  // Session context is the single source of truth for provider/model/messageHistory
  initialContext?: {
    provider: string
    model: string
    systemInstructions?: string
    messageHistory?: Array<{
      role: 'system' | 'user' | 'assistant'
      content: string
      metadata?: {
        id: string
        pinned?: boolean
        priority?: number
      }
    }>
  }
}

/**
 * Node execution state
 */
export type NodeExecutionState = 'pending' | 'executing' | 'completed' | 'paused' | 'error'

/**
 * Paused flow state (for userInput resume)
 */
export interface PausedFlowState {
  requestId: string
  nodeId: string // The node that paused
  flowDef: FlowDefinition
  args: FlowExecutionArgs
  // Scheduler state
  nodeInputs: Map<string, Record<string, any>>
  nodeOutputs: Map<string, Record<string, any>>
  nodeContexts: Map<string, ExecutionContext>
  executionState: Map<string, NodeExecutionState>
}

