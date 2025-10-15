/**
 * Flow Execution Engine V2 - Type Definitions
 * 
 * Clean, function-based execution with explicit inputs/outputs
 */

/**
 * ExecutionContext - The execution environment for a node
 * 
 * This is the primary object passed through the flow execution.
 * It contains everything a node needs to execute and communicate with LLMs.
 */
export interface ExecutionContext {
  /**
   * Unique identifier for this context (e.g., 'main', or a newContext node ID)
   * Multiple nodes can share the same context to maintain conversation continuity.
   */
  contextId: string

  /**
   * AI provider for this context (e.g., 'openai', 'anthropic', 'gemini')
   * Determines which LLM API to use.
   */
  provider: string

  /**
   * Model identifier (e.g., 'gpt-5', 'claude-3-3-sonnet', 'gemini-1.5-pro')
   * Specific model within the provider to use.
   */
  model: string

  /**
   * Optional system instructions for this context
   * Sent as the first message to guide the LLM's behavior.
   * Only sent once at the start of a conversation.
   */
  systemInstructions?: string

  /**
   * Conversation history for this context
   * Shared across all nodes using the same contextId.
   * 
   * For OpenAI/Gemini: Only used for tracking, actual history managed server-side via sessionId
   * For Anthropic: Sent with every request (no server-side session management)
   */
  messageHistory: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>

  /**
   * Session ID for provider-native session management
   * Used by OpenAI and Gemini to maintain server-side conversation state.
   * Allows sending only the current message instead of full history.
   * 
   * Format: `${contextId}` (same as contextId for simplicity)
   */
  sessionId: string

  /**
   * Current output value from the most recent node in this context
   * Used for context propagation - when a node passes context to the next node,
   * this contains the output that should be used as input.
   */
  currentOutput: string

  /**
   * Internal: WebContents for sending events to renderer
   * Prefixed with _ to indicate it's not part of the conversation state
   */
  _wc?: any

  /**
   * Internal: Request ID for this flow execution
   * Prefixed with _ to indicate it's not part of the conversation state
   */
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
   * The updated execution context after this node runs.
   * Flows through 'context' handle.
   *
   * Every node must output context, even if unchanged.
   */
  context: ExecutionContext

  /**
   * Data output - OPTIONAL
   * Simple data values produced by this node.
   * Examples:
   * - userInput node: the user's message string
   * - chat node: the assistant's response string
   *
   * Flows through 'data' handle.
   */
  data?: any

  /**
   * Tools output - OPTIONAL
   * Array of tool definitions for chat nodes.
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
 * NodeFunction - The signature for all node implementations
 *
 * Nodes receive three types of inputs:
 * 1. contextIn: Execution context from predecessor (via context edge)
 * 2. dataIn: Simple data value from predecessor (via data edge)
 * 3. config: Node-specific configuration
 *
 * Additional inputs (like tools) come via the inputs object.
 */
export type NodeFunction = (
  contextIn: ExecutionContext,
  dataIn: any,
  inputs: Record<string, any>,
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
  type: string // Node type (e.g., 'chat', 'userInput', 'tools')
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
  provider?: string
  model?: string
  input?: string
  sessionId?: string
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

