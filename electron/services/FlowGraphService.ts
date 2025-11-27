/**
 * Flow Graph Service
 * 
 * Stores the last-saved flow graph for the scheduler to read.
 * The renderer owns the live editing state - this is just a snapshot.
 * 
 * Responsibilities:
 * - Store last-saved graph (nodes/edges)
 * - Provide graph to scheduler for execution
 * - Persist graph when user saves
 * 
 * NOTE: The renderer has its own local flow editor store for live editing.
 * This service only stores the "committed" graph that the scheduler reads.
 */

import { Service } from './base/Service.js'
import type { Node, Edge } from 'reactflow'

interface FlowGraphState {
  // Last-saved graph (used by scheduler)
  nodes: Node[]
  edges: Edge[]
  
  // Selected node (for config panel)
  selectedNodeId: string | null
}

export class FlowGraphService extends Service<FlowGraphState> {
  constructor() {
    super({
      nodes: [],
      edges: [],
      selectedNodeId: null,
    })
  }

  protected onStateChange(updates: Partial<FlowGraphState>): void {
    // Graph state is transient, no persistence needed
    // (Graphs are persisted as flow profiles, not as raw state)

    // Emit events when graph changes
    if (updates.nodes !== undefined || updates.edges !== undefined) {
      this.events.emit('flowGraph:changed', {
        nodes: this.state.nodes,
        edges: this.state.edges,
      })
    }
  }

  // Getters
  getNodes(): Node[] {
    return this.state.nodes
  }

  getEdges(): Edge[] {
    return this.state.edges
  }

  getGraph(): { nodes: Node[]; edges: Edge[] } {
    return {
      nodes: this.state.nodes,
      edges: this.state.edges,
    }
  }

  getSelectedNodeId(): string | null {
    return this.state.selectedNodeId
  }

  getNode(nodeId: string): Node | undefined {
    return this.state.nodes.find((n) => n.id === nodeId)
  }

  /**
   * Set the graph (called when user saves in renderer)
   * This is the "committed" graph that the scheduler will read
   */
  setGraph(params: { nodes: Node[]; edges: Edge[] }): void {
    const { nodes, edges } = params

    console.log('[FlowGraph] Setting graph:', {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    })

    this.setState({ nodes, edges })
  }

  /**
   * Set selected node
   */
  setSelectedNodeId(params: { id: string | null }): void {
    this.setState({ selectedNodeId: params.id })
  }

  /**
   * Update node label
   */
  setNodeLabel(params: { id: string; label: string }): void {
    const { id, label } = params

    const nodes = this.state.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, label } } : n
    )

    this.setState({ nodes })
  }

  /**
   * Patch node config
   */
  patchNodeConfig(params: { id: string; patch: Record<string, any> }): void {
    const { id, patch } = params

    const nodes = this.state.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
    )

    this.setState({ nodes })
  }

  /**
   * Clear the graph
   */
  clearGraph(): void {
    this.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
    })
  }
}

