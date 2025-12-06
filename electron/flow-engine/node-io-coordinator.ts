import type { Edge, NodeOutput } from './types'

type ExecuteNodeFn = (
  nodeId: string,
  pushedInputs: Record<string, any>,
  callerId: string | null,
  isPull?: boolean
) => Promise<NodeOutput>

export type EdgeLookup = (nodeId: string) => Edge[]

export type QueuePushResult =
  | { type: 'ready'; initialInputs: Record<string, any> }
  | { type: 'waiting'; waitingFor: string[] }

export class FlowNodeIoCoordinator {
  private readonly pushedInputsByNode = new Map<string, Record<string, any>>()
  private readonly pendingPushesByNode = new Map<string, Record<string, any>>()
  private readonly inputWaiters = new Map<string, Map<string, Array<() => void>>>()
  private readonly inFlightExecutions = new Map<string, Promise<NodeOutput>>()

  constructor(
    private readonly getIncomingEdges: EdgeLookup,
    private readonly executeNode: ExecuteNodeFn
  ) {}

  registerExecution(nodeId: string, pushedInputs: Record<string, any>, promise: Promise<NodeOutput>): void {
    this.pushedInputsByNode.set(nodeId, { ...(pushedInputs || {}) })
    this.inFlightExecutions.set(nodeId, promise)
    promise.finally(() => {
      this.inFlightExecutions.delete(nodeId)
      this.pushedInputsByNode.delete(nodeId)
    }).catch(() => {})
  }

  getInFlightExecution(nodeId: string): Promise<NodeOutput> | undefined {
    return this.inFlightExecutions.get(nodeId)
  }

  mergeIntoLiveInputs(nodeId: string, newInputs: Record<string, any>): Record<string, any> {
    const current = this.pushedInputsByNode.get(nodeId) || {}
    const merged = { ...current, ...newInputs }
    this.pushedInputsByNode.set(nodeId, merged)
    this.resolveNodeInputWaiters(nodeId, Object.keys(newInputs))
    return merged
  }

  queuePendingInputs(nodeId: string, newInputs: Record<string, any>): QueuePushResult {
    const merged = { ...(this.pendingPushesByNode.get(nodeId) || {}), ...newInputs }
    this.pendingPushesByNode.set(nodeId, merged)
    this.resolveNodeInputWaiters(nodeId, Object.keys(newInputs))

    const waitingFor = this.calculateMissingInputs(nodeId, merged)
    if (waitingFor.length === 0) {
      this.pendingPushesByNode.delete(nodeId)
      return { type: 'ready', initialInputs: { ...merged } }
    }

    return { type: 'waiting', waitingFor }
  }

  createPullFunction(nodeId: string): (inputName: string) => Promise<any> {
    return async (inputName: string) => {
      const livePushed = this.pushedInputsByNode.get(nodeId) || {}
      if (inputName in livePushed) {
        return (livePushed as any)[inputName]
      }

      const edgesForInput = this.getEdgesForInput(nodeId, inputName)
      if (edgesForInput.length === 0) {
        throw new Error(`No edge found for input '${inputName}' on node '${nodeId}'`)
      }
      if (edgesForInput.length > 1) {
        throw new Error(`Invalid graph: multiple edges target input '${inputName}' on node '${nodeId}'`)
      }

      const edge = edgesForInput[0]
      const inFlight = this.inFlightExecutions.get(edge.source)
      if (inFlight) {
        const res = await inFlight
        if (edge.sourceOutput in res) {
          return (res as any)[edge.sourceOutput]
        }
        return undefined
      }

      const initialFromPending = this.consumePendingInputs(edge.source)
      const sourceResult = await this.executeNode(edge.source, initialFromPending, nodeId, true)
      if (edge.sourceOutput in sourceResult) {
        return (sourceResult as any)[edge.sourceOutput]
      }
      return undefined
    }
  }

  createHasFunction(nodeId: string): (inputName: string) => boolean {
    return (inputName: string) => {
      const pushed = this.pushedInputsByNode.get(nodeId) || {}
      if (inputName in pushed) {
        return true
      }

      const edgesForInput = this.getIncomingEdges(nodeId).filter(edge => edge.targetInput === inputName)
      if (edgesForInput.length === 1) {
        return true
      }
      if (edgesForInput.length > 1) {
        return false
      }
      return false
    }
  }

  waitForNodeInput(nodeId: string, inputName: string): Promise<void> {
    const pushed = this.pushedInputsByNode.get(nodeId) || {}
    const pending = this.pendingPushesByNode.get(nodeId) || {}
    if (inputName in pushed || inputName in pending) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      let byInput = this.inputWaiters.get(nodeId)
      if (!byInput) {
        byInput = new Map<string, Array<() => void>>()
        this.inputWaiters.set(nodeId, byInput)
      }
      const arr = byInput.get(inputName) || []
      arr.push(resolve)
      byInput.set(inputName, arr)
    })
  }

  private getEdgesForInput(nodeId: string, inputName: string): Edge[] {
    const incomingEdges = this.getIncomingEdges(nodeId) || []
    return incomingEdges.filter(edge => edge.targetInput === inputName)
  }

  private consumePendingInputs(nodeId: string): Record<string, any> {
    const pending = this.pendingPushesByNode.get(nodeId)
    if (!pending) {
      return {}
    }
    this.pendingPushesByNode.delete(nodeId)
    return { ...pending }
  }

  private calculateMissingInputs(nodeId: string, merged: Record<string, any>): string[] {
    const incoming = this.getIncomingEdges(nodeId) || []
    const counts = new Map<string, number>()
    let requiresContext = false
    for (const edge of incoming) {
      if (edge.targetInput === 'tools') continue
      const key = edge.targetInput || 'context'
      if (key === 'context') {
        requiresContext = true
      }
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    const missingAmbiguous = Array.from(counts.entries())
      .filter(([name, count]) => count > 1 && !(name in merged))
      .map(([name]) => name)

    const waitingFor = [...missingAmbiguous]
    if (requiresContext && !('context' in merged)) {
      waitingFor.push('context')
    }

    return waitingFor
  }

  private resolveNodeInputWaiters(nodeId: string, availableKeys: string[]): void {
    const byInput = this.inputWaiters.get(nodeId)
    if (!byInput) return
    for (const key of availableKeys) {
      const arr = byInput.get(key)
      if (arr && arr.length) {
        for (const fn of arr) {
          try { fn() } catch {}
        }
        byInput.delete(key)
      }
    }
    if (byInput.size === 0) {
      this.inputWaiters.delete(nodeId)
    }
  }
}

