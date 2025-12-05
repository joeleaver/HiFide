import type { Edge, FlowDefinition } from './types'

export interface FlowGraph {
  incomingEdges: Map<string, Edge[]>
  outgoingEdges: Map<string, Edge[]>
}

export function buildFlowGraph(flowDef: FlowDefinition): FlowGraph {
  const incomingEdges = new Map<string, Edge[]>()
  const outgoingEdges = new Map<string, Edge[]>()

  const nodesById = new Map<string, any>()
  for (const node of flowDef.nodes) {
    nodesById.set(node.id, node)
  }

  const baseEdges: Edge[] = flowDef.edges.map(edge => ({
    ...edge,
    sourceOutput: canonicalizeHandleName(edge.sourceHandle),
    targetInput: canonicalizeHandleName(edge.targetHandle),
  }))

  const portalInputsByKey = new Map<string, string[]>()
  const portalOutputsByKey = new Map<string, string[]>()

  for (const node of flowDef.nodes) {
    const nodeType = (node as any).nodeType || (node as any).data?.nodeType || (node as any).type
    if (nodeType !== 'portalInput' && nodeType !== 'portalOutput') continue
    const portalId = (node as any)?.config?.id || (node as any)?.data?.config?.id
    if (!portalId) continue

    const targetMap = nodeType === 'portalInput' ? portalInputsByKey : portalOutputsByKey
    const arr = targetMap.get(portalId) || []
    arr.push(node.id)
    targetMap.set(portalId, arr)
  }

  const isPortalNode = (id: string) => {
    const node = nodesById.get(id)
    if (!node) return false
    const type = (node as any).nodeType || (node as any).data?.nodeType || (node as any).type
    return type === 'portalInput' || type === 'portalOutput'
  }

  const nonPortalEdges = baseEdges.filter(edge => !isPortalNode(edge.source) && !isPortalNode(edge.target))

  const bridgedEdges: Edge[] = []
  for (const [portalKey, inputNodeIds] of portalInputsByKey.entries()) {
    const outputNodeIds = portalOutputsByKey.get(portalKey) || []
    if (outputNodeIds.length === 0) continue

    const incomingToPortal = baseEdges.filter(edge => inputNodeIds.includes(edge.target))
    const outgoingFromPortal = baseEdges.filter(edge => outputNodeIds.includes(edge.source))

    for (const outgoing of outgoingFromPortal) {
      for (const incoming of incomingToPortal) {
        if (outgoing.targetInput !== incoming.sourceOutput) continue

        bridgedEdges.push({
          id: `bridge:${incoming.id}=>${outgoing.id}`,
          source: incoming.source,
          sourceOutput: incoming.sourceOutput,
          sourceHandle: incoming.sourceOutput,
          target: outgoing.target,
          targetInput: outgoing.targetInput,
          targetHandle: outgoing.targetInput,
          metadata: {
            ...(incoming.metadata || {}),
            isContextEdge: (incoming.metadata?.isContextEdge ?? false) || (outgoing.metadata?.isContextEdge ?? false)
          }
        })
      }
    }
  }

  const deduped = new Map<string, Edge>()
  for (const edge of [...nonPortalEdges, ...bridgedEdges]) {
    const key = `${edge.source}|${edge.sourceOutput}|${edge.target}|${edge.targetInput}`
    if (!deduped.has(key)) {
      deduped.set(key, edge)
    }
  }

  for (const edge of deduped.values()) {
    const incoming = incomingEdges.get(edge.target) || []
    incoming.push(edge)
    incomingEdges.set(edge.target, incoming)

    const outgoing = outgoingEdges.get(edge.source) || []
    outgoing.push(edge)
    outgoingEdges.set(edge.source, outgoing)
  }

  try {
    const bridgedCount = bridgedEdges.length
    if (bridgedCount > 0) {
      console.log(`[FlowGraph] Portal bridging created ${bridgedCount} virtual edge(s).`)
    }
  } catch {}

  return { incomingEdges, outgoingEdges }
}

export function canonicalizeHandleName(name?: string | null): 'context' | 'data' | 'tools' | string {
  if (!name) return 'context'
  const raw = String(name).trim().toLowerCase()
  const normalized = raw.replace(/\s+|[-_]/g, '')

  if (normalized === 'context' || normalized === 'contextin' || normalized === 'contextout' || normalized === 'ctx' || normalized === 'ctxin' || normalized === 'ctxout') {
    return 'context'
  }

  if (normalized === 'data' || normalized === 'datain' || normalized === 'dataout' || normalized === 'value' || normalized === 'output') {
    return 'data'
  }

  if (normalized === 'tools' || normalized === 'toolsin' || normalized === 'toolsout') {
    return 'tools'
  }

  return name
}

