import crypto from 'node:crypto'

import { getNodeFunction } from './nodes'
import type { FlowDefinition, NodeInputs, NodeOutput } from './types'
import type { FlowNodeIoCoordinator } from './node-io-coordinator'
import type { FlowApiFactory } from './flow-api-factory'

import { ContextLifecycleManager } from './context-lifecycle-manager'
import { emitFlowEvent } from './events'
import { isCancellationError } from './cancellation'

interface FlowNodeRunnerOptions {
  flowDefinition: FlowDefinition
  flowApiFactory: FlowApiFactory
  ioCoordinator: FlowNodeIoCoordinator
  contextLifecycle: ContextLifecycleManager
  abortSignal: AbortSignal
  requestId: string
  sessionId?: string
  getNodeConfig: (nodeId: string) => Promise<Record<string, any>>
  flushToSession: () => Promise<void>
  onNodeStart?: (nodeId: string) => void
  onNodeEnd?: (nodeId: string) => void
}

interface RunNodeParams {
  nodeId: string
  pushedInputs: Record<string, any>
  callerId: string | null
  isPull: boolean
}

export class FlowNodeRunner {
  private readonly flowDefinition: FlowDefinition
  private readonly flowApiFactory: FlowApiFactory
  private readonly ioCoordinator: FlowNodeIoCoordinator
  private readonly contextLifecycle: ContextLifecycleManager
  private readonly abortSignal: AbortSignal
  private readonly requestId: string
  private readonly sessionId?: string
  private readonly getNodeConfig: (nodeId: string) => Promise<Record<string, any>>
  private readonly flushToSession: () => Promise<void>
  private readonly onNodeStart?: (nodeId: string) => void
  private readonly onNodeEnd?: (nodeId: string) => void

  constructor(options: FlowNodeRunnerOptions) {
    this.flowDefinition = options.flowDefinition
    this.flowApiFactory = options.flowApiFactory
    this.ioCoordinator = options.ioCoordinator
    this.contextLifecycle = options.contextLifecycle
    this.abortSignal = options.abortSignal
    this.requestId = options.requestId
    this.sessionId = options.sessionId
    this.getNodeConfig = options.getNodeConfig
    this.flushToSession = options.flushToSession
    this.onNodeStart = options.onNodeStart
    this.onNodeEnd = options.onNodeEnd
  }

  async run(params: RunNodeParams): Promise<NodeOutput> {
    const { nodeId, pushedInputs, callerId, isPull } = params
    const startTime = Date.now()

    if (this.abortSignal.aborted) {
      throw new Error('Flow execution cancelled')
    }

    const executionId = crypto.randomUUID()
    console.log(`[Scheduler] ${nodeId} - Starting execution ${executionId}, isPull: ${isPull}, callerId: ${callerId}, pushedInputs:`, Object.keys(pushedInputs))

    try { emitFlowEvent(this.requestId, { type: 'nodeStart', nodeId, executionId, sessionId: this.sessionId }) } catch {}
    try { this.onNodeStart?.(nodeId) } catch {}

    try {
      const nodeDefinition = this.flowDefinition.nodes.find(n => n.id === nodeId)
      if (!nodeDefinition) {
        throw new Error(`Node '${nodeId}' not found in flow definition`)
      }
      const config = await this.getNodeConfig(nodeId)
      const activeBinding = this.contextLifecycle.resolveActiveBinding(pushedInputs)
      const contextIn = activeBinding.ref.current
      const dataIn = pushedInputs.data

      console.log(`[Scheduler] ${nodeId} - Using context snapshot:`, {
        contextId: contextIn.contextId,
        contextType: contextIn.contextType,
        provider: contextIn.provider,
        model: contextIn.model
      })

      const flowAPI = this.flowApiFactory({ nodeId, executionId, binding: activeBinding })
      const inputs: NodeInputs = {
        pull: this.ioCoordinator.createPullFunction(nodeId),
        has: this.ioCoordinator.createHasFunction(nodeId)
      }

      const nodeFunction = getNodeFunction(nodeDefinition)
      const result = await nodeFunction(flowAPI, contextIn, dataIn, inputs, config)

      this.contextLifecycle.ensureContextOutput(result, activeBinding)

      await this.flushToSession()
      this.contextLifecycle.publishContextState()

      const durationMs = Date.now() - startTime
      try { emitFlowEvent(this.requestId, { type: 'nodeEnd', nodeId, durationMs, executionId, sessionId: this.sessionId }) } catch {}

      if (result.status === 'error') {
        const errorMsg = result.error || 'Node execution failed'
        console.error(`[Scheduler] ${nodeId} - ERROR:`, errorMsg)
        throw new Error(errorMsg)
      }

      return result
    } catch (error: any) {
      if (isCancellationError(error)) {
        console.log(`[FlowScheduler] ${nodeId} cancelled`)
        throw error
      }

      const message = error?.message || String(error)
      console.error(`[FlowScheduler] Error in ${nodeId}:`, message)
      try {
        emitFlowEvent(this.requestId, {
          type: 'error',
          nodeId,
          error: message,
          sessionId: this.sessionId,
        })
      } catch {}
      throw error
    } finally {
      try { this.onNodeEnd?.(nodeId) } catch {}
    }
  }
}
