import dagre from 'dagre'
import type { Node, Edge } from 'reactflow'

/**
 * Auto-layout nodes using Dagre algorithm
 * Creates a hierarchical top-to-bottom layout with improved edge routing
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): Node[] {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const nodeWidth = 250
  const nodeHeight = 150

  // Configure the graph layout with improved settings for edge routing
  dagreGraph.setGraph({
    rankdir: direction,
    align: 'UL', // Align nodes to upper-left to reduce edge crossings
    nodesep: 200, // Much more horizontal spacing between nodes on same rank
    ranksep: 150, // Vertical spacing between ranks
    edgesep: 100, // Edge separation
    ranker: 'network-simplex', // Better ranking algorithm for fewer edge crossings
    acyclicer: 'greedy', // Handle cycles better
    marginx: 40,
    marginy: 40,
  })

  // Find the defaultContextStart node
  const startNode = nodes.find((n) => {
    const kind = (n.data as any)?.kind
    return kind === 'defaultContextStart' || n.id === 'defaultContextStart' || n.id.startsWith('defaultContextStart')
  })

  // Add a virtual root node to force defaultContextStart to the top
  const VIRTUAL_ROOT = '__virtual_root__'
  if (startNode) {
    dagreGraph.setNode(VIRTUAL_ROOT, { width: 0, height: 0 })
  }

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  })

  // Add edges to dagre graph with different weights
  // Context edges should have higher weight to establish hierarchy
  // Result/Data edges should have lower weight as they're secondary
  edges.forEach((edge) => {
    const targetHandle = (edge as any).targetHandle
    const sourceHandle = (edge as any).sourceHandle
    const isContextEdge = (sourceHandle === 'context' && targetHandle === 'input') ||
                          (sourceHandle === 'context' && targetHandle === 'context') ||
                          targetHandle === 'context' || targetHandle === 'input'

    dagreGraph.setEdge(edge.source, edge.target, {
      weight: isContextEdge ? 10 : 1, // Context edges are 10x more important for layout
      minlen: isContextEdge ? 1 : 1,  // Minimum edge length
    })
  })

  // Add virtual edge from root to defaultContextStart with highest weight
  if (startNode) {
    dagreGraph.setEdge(VIRTUAL_ROOT, startNode.id, { weight: 100 })
  }

  // Calculate layout
  dagre.layout(dagreGraph)

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    }
  })

  return layoutedNodes
}

