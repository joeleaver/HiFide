export type NodeKind =
  | 'defaultContextStart'
  | 'userMessage'
  | 'manualInput'
  | 'llmRequest'
  | 'tools'
  | 'approvalGate'
  | 'budgetGuard'
  | 'errorDetection'
  | 'redactor'
  | 'capabilityGuard'
  | 'conditional'
  | 'parallelSplit'
  | 'parallelJoin'
  | 'modelRouter'
  | 'toolSelector'
  | 'retryWithBackoff'
  | 'cache'
  | 'toolSandbox'
  | 'newContext'
  | 'portalInput'
  | 'portalOutput'
  // Planned kinds (Phase 2/3+): intentClassifier, router, conditional, transform, merge, loop/while/until
  | (string & {})

export type FlowNode = {
  id: string
  type: NodeKind
  label?: string
  config?: Record<string, any>
}

export type FlowEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string  // e.g., 'context', 'data', 'out-1', 'out-2'
  targetHandle?: string  // e.g., 'context', 'data-1', 'data-2', 'data-3'
  label?: string
}

export type FlowDefinition = {
  id: string
  label?: string
  version: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  // optional metadata/config bag
  config?: Record<string, any>
}

