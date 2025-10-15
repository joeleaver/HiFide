/**
 * Flow Scheduler - Pure Push/Pull Model
 *
 * Key concepts:
 * - PUSH: A node completes and calls its successors with outputs
 * - PULL: A node needs an input and executes the source node to get it
 * - Caching: Pull results are cached to prevent re-execution and cycles
 * - Nodes are async functions that await naturally (no pause/resume state machine)
 */

import type { WebContents } from 'electron'
import type {
  ExecutionContext,
  FlowDefinition,
  Edge,
  NodeOutput,
  FlowExecutionArgs,
} from './types'
import { getNodeFunction } from './nodes'
import { sendFlowEvent } from './events'

export class FlowScheduler {
  // Graph structure
  private flowDef: FlowDefinition
  private incomingEdges = new Map<string, Edge[]>()
  private outgoingEdges = new Map<string, Edge[]>()
  
  // Execution context
  private wc: WebContents | undefined
  private requestId: string
  private args: FlowExecutionArgs
  
  // Pull cache: stores results from nodes executed via pull
  private pullCache = new Map<string, NodeOutput>()
  
  // Pull promises: prevents duplicate execution of same pull
  private pullPromises = new Map<string, Promise<NodeOutput>>()

  // User input promises: for nodes waiting for external input
  private userInputResolvers = new Map<string, (value: string) => void>()

  constructor(
    wc: WebContents | undefined,
    requestId: string,
    flowDef: FlowDefinition,
    args: FlowExecutionArgs
  ) {
    this.wc = wc
    this.requestId = requestId
    this.flowDef = flowDef
    this.args = args
    
    this.buildGraphStructure()
  }
  
  /**
   * Build graph structure for efficient edge lookups
   */
  private buildGraphStructure(): void {
    for (const edge of this.flowDef.edges) {
      // Use handle names directly as field names (no mapping needed!)
      // sourceHandle 'context' → sourceOutput 'context'
      // targetHandle 'context' → targetInput 'context'
      const mappedEdge: Edge = {
        ...edge,
        sourceOutput: edge.sourceHandle || 'context',
        targetInput: edge.targetHandle || 'context',
      }

      // Incoming edges (for pulling)
      const incoming = this.incomingEdges.get(edge.target) || []
      incoming.push(mappedEdge)
      this.incomingEdges.set(edge.target, incoming)

      // Outgoing edges (for pushing)
      const outgoing = this.outgoingEdges.get(edge.source) || []
      outgoing.push(mappedEdge)
      this.outgoingEdges.set(edge.source, outgoing)
    }

    console.log('[FlowScheduler] Graph built:', {
      nodes: this.flowDef.nodes.length,
      edges: this.flowDef.edges.length
    })
  }
  
  /**
   * Execute the flow starting from entry nodes
   */
  async execute(): Promise<{ ok: boolean; error?: string }> {
    try {
      sendFlowEvent(this.wc, this.requestId, {
        type: 'io',
        nodeId: 'system',
        data: '[FlowScheduler] Starting execution'
      })

      // Find entry nodes (nodes with no incoming edges)
      const entryNodes = this.flowDef.nodes
        .filter(n => !this.incomingEdges.has(n.id))
        .map(n => n.id)

      console.log('[FlowScheduler] Entry nodes:', entryNodes)
      sendFlowEvent(this.wc, this.requestId, {
        type: 'io',
        nodeId: 'system',
        data: `[Entry] ${entryNodes.join(', ')}`
      })

      // Execute each entry node (PULL with no pushed inputs)
      for (const nodeId of entryNodes) {
        await this.executeNode(nodeId, {}, null)
      }

      sendFlowEvent(this.wc, this.requestId, {
        type: 'io',
        nodeId: 'system',
        data: '[FlowScheduler] Execution complete'
      })

      return { ok: true }
    } catch (e: any) {
      const error = e?.message || String(e)
      console.error('[FlowScheduler] Error:', error)
      sendFlowEvent(this.wc, this.requestId, { type: 'error', error })
      return { ok: false, error }
    }
  }
  
  /**
   * Execute a node with push/pull model
   * 
   * @param nodeId - The node to execute
   * @param pushedInputs - Inputs provided by the caller (push)
   * @param callerId - ID of the node that called this one (for logging and preventing pull cycles)
   */
  private async executeNode(
    nodeId: string,
    pushedInputs: Record<string, any>,
    callerId: string | null
  ): Promise<NodeOutput> {
    // Determine if this is a push or pull
    // Push = called by another node with outputs
    // Pull = called to satisfy a dependency (no caller or empty inputs)
    const isPush = callerId !== null && Object.keys(pushedInputs).length > 0

    console.log(`[FlowScheduler] executeNode: ${nodeId}`, {
      isPush,
      callerId,
      pushedInputKeys: Object.keys(pushedInputs)
    })

    // If this is a PULL and we're already executing, await the existing promise
    if (!isPush && this.pullPromises.has(nodeId)) {
      console.log(`[FlowScheduler] ${nodeId} already executing (pull), awaiting existing promise`)
      return await this.pullPromises.get(nodeId)!
    }

    // If this is a PULL and we have cached result, return it
    if (!isPush && this.pullCache.has(nodeId)) {
      console.log(`[FlowScheduler] ${nodeId} returning cached result (pull)`)
      return this.pullCache.get(nodeId)!
    }
    
    const executionPromise = this.doExecuteNode(nodeId, pushedInputs, callerId, isPush)
    
    // Cache the promise if this is a pull
    if (!isPush) {
      this.pullPromises.set(nodeId, executionPromise)
    }
    
    const result = await executionPromise
    
    // Clean up promise cache
    if (!isPush) {
      this.pullPromises.delete(nodeId)
    }
    
    return result
  }
  
  /**
   * Actually execute the node (separated for promise caching)
   */
  private async doExecuteNode(
    nodeId: string,
    pushedInputs: Record<string, any>,
    callerId: string | null,
    isPush: boolean
  ): Promise<NodeOutput> {
    const startTime = Date.now()
    
    sendFlowEvent(this.wc, this.requestId, { type: 'nodeStart', nodeId })
    
    if (callerId) {
      sendFlowEvent(this.wc, this.requestId, { 
        type: 'io', 
        nodeId, 
        data: `[Called by] ${callerId}` 
      })
    }
    
    try {
      // Start with pushed inputs
      const allInputs = { ...pushedInputs }
      
      // PULL PHASE: Get any missing inputs
      const incomingEdges = this.incomingEdges.get(nodeId) || []
      
      for (const edge of incomingEdges) {
        const inputName = edge.targetInput
        
        // Skip if we already have this input from push
        if (inputName in pushedInputs) {
          console.log(`[FlowScheduler] ${nodeId} already has ${inputName} from push`)
          continue
        }
        
        // Skip if this edge is from our caller (prevent immediate cycle)
        if (edge.source === callerId) {
          console.log(`[FlowScheduler] ${nodeId} skipping pull from caller ${callerId}`)
          continue
        }
        
        // PULL from source node
        console.log(`[FlowScheduler] ${nodeId} pulling ${inputName} from ${edge.source}`)
        sendFlowEvent(this.wc, this.requestId, {
          type: 'io',
          nodeId,
          data: `[Pull] ${inputName} from ${edge.source}`
        })

        const sourceResult = await this.executeNode(edge.source, {}, nodeId)

        // Extract the specific output from source
        const sourceOutput = edge.sourceOutput
        if (sourceOutput in sourceResult) {
          allInputs[inputName] = (sourceResult as any)[sourceOutput]
        }
      }
      
      // Get node configuration
      const nodeConfig = this.flowDef.nodes.find(n => n.id === nodeId)
      const config = nodeConfig?.config || {}
      
      // Separate inputs into context, data, and others
      const contextIn = allInputs.context || this.createDefaultContext()
      const dataIn = allInputs.data
      const otherInputs: Record<string, any> = {}
      for (const [key, value] of Object.entries(allInputs)) {
        if (key !== 'context' && key !== 'data') {
          otherInputs[key] = value
        }
      }
      
      // Ensure context has _wc, _requestId, and _scheduler
      contextIn._wc = this.wc
      contextIn._requestId = this.requestId
      ;(contextIn as any)._scheduler = this

      // Add nodeId to config for nodes that need it
      const configWithNodeId = { ...config, _nodeId: nodeId }

      // Execute the node function
      sendFlowEvent(this.wc, this.requestId, {
        type: 'io',
        nodeId,
        data: '[Execute] Calling node function'
      })

      const nodeFunction = getNodeFunction(nodeConfig!)
      const result = await nodeFunction(contextIn, dataIn, otherInputs, configWithNodeId)
      
      // Cache result if this was a pull
      if (!isPush) {
        this.pullCache.set(nodeId, result)
      }
      
      const durationMs = Date.now() - startTime
      sendFlowEvent(this.wc, this.requestId, { type: 'nodeEnd', nodeId, durationMs })
      
      // PUSH PHASE: Call successors with our outputs
      // Note: Some nodes (like tools) are pull-only and don't push to successors
      const outgoingEdges = this.outgoingEdges.get(nodeId) || []

      // Filter out pull-only edges (tools edges should only be pulled, not pushed)
      const pushEdges = outgoingEdges.filter(edge => {
        // Tools edges are pull-only - they should not trigger execution
        if (edge.sourceOutput === 'tools') {
          return false
        }
        return true
      })

      const successorIds = new Set(pushEdges.map(e => e.target))

      if (successorIds.size > 0) {
        sendFlowEvent(this.wc, this.requestId, {
          type: 'io',
          nodeId,
          data: `[Push] → ${Array.from(successorIds).join(', ')}`
        })
      }

      for (const successorId of successorIds) {
        // Collect all outputs going to this successor
        const pushedData: Record<string, any> = {}

        for (const edge of pushEdges) {
          if (edge.target === successorId) {
            const sourceOutput = edge.sourceOutput
            const targetInput = edge.targetInput

            console.log(`[FlowScheduler] ${nodeId} → ${successorId}: checking edge ${sourceOutput} → ${targetInput}`)
            console.log(`[FlowScheduler]   sourceOutput in result:`, sourceOutput in result)
            console.log(`[FlowScheduler]   result keys:`, Object.keys(result))

            if (sourceOutput in result) {
              const value = (result as any)[sourceOutput]
              console.log(`[FlowScheduler]   pushing ${targetInput} =`, typeof value, value?.substring?.(0, 50) || value)
              pushedData[targetInput] = value
            }
          }
        }

        console.log(`[FlowScheduler] ${nodeId} pushing to ${successorId} with keys:`, Object.keys(pushedData))

        // Only push to successor if we have data to push
        // This prevents calling successors with empty inputs (which would be treated as a pull)
        if (Object.keys(pushedData).length > 0) {
          await this.executeNode(successorId, pushedData, nodeId)
        } else {
          console.log(`[FlowScheduler] ${nodeId} skipping push to ${successorId} (no matching outputs)`)
        }
      }
      
      return result
    } catch (e: any) {
      const error = e?.message || String(e)
      console.error(`[FlowScheduler] Error in ${nodeId}:`, error)
      sendFlowEvent(this.wc, this.requestId, { type: 'error', nodeId, error })
      throw e
    }
  }
  
  /**
   * Create default execution context
   */
  private createDefaultContext(): ExecutionContext {
    return {
      contextId: 'main',
      provider: this.args.provider || 'openai',
      model: this.args.model || 'gpt-4',
      messageHistory: [],
      sessionId: 'main',
      currentOutput: '',
      _wc: this.wc,
      _requestId: this.requestId
    }
  }
  
  /**
   * Wait for user input (called by userInput node)
   */
  async waitForUserInput(nodeId: string): Promise<string> {
    console.log(`[FlowScheduler] ${nodeId} waiting for user input`)

    sendFlowEvent(this.wc, this.requestId, {
      type: 'waitingForInput',
      nodeId
    })

    // Create a promise that will be resolved when resumeWithInput is called
    const userInput = await new Promise<string>((resolve) => {
      this.userInputResolvers.set(nodeId, resolve)
    })

    console.log(`[FlowScheduler] ${nodeId} received user input:`, userInput.substring(0, 50))
    this.userInputResolvers.delete(nodeId)

    return userInput
  }

  /**
   * Resolve a waiting user input promise
   * This doesn't "resume" the flow - the flow is already running, just awaiting this promise
   */
  resolveUserInput(nodeId: string, userInput: string): void {
    console.log(`[FlowScheduler] resolveUserInput for ${nodeId}:`, userInput.substring(0, 50))

    const resolver = this.userInputResolvers.get(nodeId)
    if (resolver) {
      resolver(userInput)
    } else {
      console.warn(`[FlowScheduler] No resolver found for ${nodeId}`)
    }
  }
}


