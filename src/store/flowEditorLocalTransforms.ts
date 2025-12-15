import type { LocalFlowEdge, LocalFlowNode } from './flowEditorLocal'

const NODE_RUNTIME_KEYS = new Set<string>([
  '__rf',
  '_rf',
  'dragging',
  'draggingPosition',
  'draggingStatus',
  'draggingStart',
  'draggingHandle',
  'selected',
  'hidden',
  'width',
  'height',
  'measured',
  'handleBounds',
  'internalsSymbol',
  'positionAbsolute',
  'resizing',
  'zIndex',
])

const NODE_DATA_RUNTIME_KEYS = new Set<string>([
  'status',
  'cacheHit',
  'durationMs',
  'costUSD',
  'detectedIntent',
  'onLabelChange',
  'onConfigChange',
  'onExpandToggle',
])

const EDGE_RUNTIME_KEYS = new Set<string>([
  '__rf',
  '_rf',
  'selected',
  'hidden',
  'interactionWidth',
])

const EDGE_DATA_RUNTIME_KEYS = new Set<string>([
  'status',
])

const graphReplacer = (_key: string, value: any) => (typeof value === 'function' ? undefined : value)

const clonePosition = (pos: any) => {
  if (!pos || typeof pos !== 'object') return undefined
  const x = typeof pos.x === 'number' && Number.isFinite(pos.x) ? pos.x : 0
  const y = typeof pos.y === 'number' && Number.isFinite(pos.y) ? pos.y : 0
  return { x, y }
}

const stripKeys = (target: Record<string, any>, keys: Set<string>) => {
  for (const key of keys) {
    if (key in target) {
      delete target[key]
    }
  }
}

const sanitizeNodeData = (data: any) => {
  if (!data || typeof data !== 'object') return {}
  const clone: Record<string, any> = { ...data }
  stripKeys(clone, NODE_DATA_RUNTIME_KEYS)
  return clone
}

const sanitizeNode = (node: LocalFlowNode): LocalFlowNode => {
  if (!node || typeof node !== 'object') return node
  const clone: Record<string, any> = { ...node }
  if (clone.position) clone.position = clonePosition(clone.position)
  if (clone.data) clone.data = sanitizeNodeData(clone.data)
  stripKeys(clone, NODE_RUNTIME_KEYS)
  return clone as LocalFlowNode
}

const sanitizeEdgeData = (data: any) => {
  if (!data || typeof data !== 'object') return undefined
  const clone: Record<string, any> = { ...data }
  stripKeys(clone, EDGE_DATA_RUNTIME_KEYS)
  return clone
}

const sanitizeEdge = (edge: LocalFlowEdge): LocalFlowEdge => {
  if (!edge || typeof edge !== 'object') return edge
  const clone: Record<string, any> = { ...edge }
  if (clone.data) clone.data = sanitizeEdgeData(clone.data)
  stripKeys(clone, EDGE_RUNTIME_KEYS)
  return clone as LocalFlowEdge
}

export const safeGraphArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : [])

export interface SanitizedGraphSnapshot {
  nodes: LocalFlowNode[]
  edges: LocalFlowEdge[]
}

export const sanitizeGraphSnapshot = (
  nodes: LocalFlowNode[] | undefined,
  edges: LocalFlowEdge[] | undefined,
): SanitizedGraphSnapshot => ({
  nodes: safeGraphArray(nodes).map(sanitizeNode),
  edges: safeGraphArray(edges).map(sanitizeEdge),
})

export const fingerprintSanitizedGraph = (snapshot: SanitizedGraphSnapshot): string =>
  JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }, graphReplacer)

export const computeGraphSignature = (
  nodes: LocalFlowNode[] | undefined,
  edges: LocalFlowEdge[] | undefined,
): string => fingerprintSanitizedGraph(sanitizeGraphSnapshot(nodes, edges))
