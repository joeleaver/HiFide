/**
 * Flow Conversion Utilities
 *
 * Handles conversion between ReactFlow node format (UI layer) and FlowDefinition format (execution layer).
 *
 * Architecture:
 * - ReactFlow Layer: Nodes have type: 'hifiNode' with data.nodeType containing the actual node type
 * - Execution Layer: FlowDefinition nodes have type field directly (e.g., 'llmRequest', 'userInput')
 *
 * This separation exists because:
 * 1. ReactFlow requires type to be a registered node type, so all HiFide nodes use 'hifiNode'
 * 2. The actual node type is stored in data.nodeType for UI purposes
 * 3. When executing, we convert to FlowDefinition format where type is the actual node type
 */

import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import type { FlowNode, FlowDefinition, Edge } from '../ipc/flows-v2/types'

/**
 * Convert a ReactFlow node (UI format) to a FlowNode (execution format)
 *
 * ReactFlow format: { id, type: 'hifiNode', data: { nodeType, config, ... } }
 * FlowNode format: { id, type: 'llmRequest', config, ... }
 */
export function reactFlowNodeToFlowNode(rfNode: ReactFlowNode): FlowNode {
  const data = rfNode.data as any
  return {
    id: rfNode.id,
    type: data?.nodeType || rfNode.id.split('-')[0], // Fallback to id prefix if nodeType missing
    config: data?.config || {},
    position: rfNode.position,
    data: data,
  }
}

/**
 * Convert ReactFlow nodes to FlowDefinition nodes
 */
export function reactFlowNodesToFlowNodes(rfNodes: ReactFlowNode[]): FlowNode[] {
  return rfNodes.map(reactFlowNodeToFlowNode)
}

/**
 * Convert a ReactFlow edge to a FlowDefinition edge
 */
export function reactFlowEdgeToFlowEdge(rfEdge: ReactFlowEdge): Edge {
  return {
    id: rfEdge.id || `${rfEdge.source}-${rfEdge.target}`,
    source: rfEdge.source,
    target: rfEdge.target,
    sourceOutput: (rfEdge as any)?.sourceHandle || 'context',
    targetInput: (rfEdge as any)?.targetHandle || 'context',
    sourceHandle: (rfEdge as any)?.sourceHandle,
    targetHandle: (rfEdge as any)?.targetHandle,
  }
}

/**
 * Convert ReactFlow edges to FlowDefinition edges
 */
export function reactFlowEdgesToFlowEdges(rfEdges: ReactFlowEdge[]): Edge[] {
  return rfEdges.map(reactFlowEdgeToFlowEdge)
}

/**
 * Convert ReactFlow nodes and edges to a FlowDefinition
 */
export function reactFlowToFlowDefinition(
  rfNodes: ReactFlowNode[],
  rfEdges: ReactFlowEdge[],
  id: string = 'editor-current'
): FlowDefinition {
  return {
    nodes: reactFlowNodesToFlowNodes(rfNodes),
    edges: reactFlowEdgesToFlowEdges(rfEdges),
    metadata: {
      name: id,
    },
  }
}

