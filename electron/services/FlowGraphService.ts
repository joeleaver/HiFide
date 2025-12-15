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
import type { FlowGraphChangeReason } from '../../shared/flowGraph.js'

interface WorkspaceGraph {
  nodes: Node[]
  edges: Edge[]
  selectedNodeId: string | null
  selectedTemplateId: string | null  // Which flow template is currently loaded in the editor
}

interface FlowGraphState {
  // Workspace-scoped graph state
  graphsByWorkspace: Record<string, WorkspaceGraph>
}

type PendingReasonMap = Record<string, FlowGraphChangeReason>

export class FlowGraphService extends Service<FlowGraphState> {
  private pendingReasons: PendingReasonMap = {}

  constructor() {
    super({
      graphsByWorkspace: {},
    })
  }

  protected onStateChange(updates: Partial<FlowGraphState>): void {
    // Graph state is transient, no persistence needed
    // (Graphs are persisted as flow profiles, not as raw state)

    // Emit events when graph changes
    if (updates.graphsByWorkspace !== undefined) {
      for (const workspaceId in updates.graphsByWorkspace) {
        const graph = updates.graphsByWorkspace[workspaceId]
        if (graph) {
          const reason = this.pendingReasons[workspaceId] || 'unknown'
          delete this.pendingReasons[workspaceId]
          this.events.emit('flowGraph:changed', {
            workspaceId,
            nodes: graph.nodes,
            edges: graph.edges,
            reason,
          })
        }
      }
    }
  }

  // Helper to get or create workspace graph
  private getWorkspaceGraph(workspaceId: string): WorkspaceGraph {
    if (!this.state.graphsByWorkspace[workspaceId]) {
      // Initialize empty graph for this workspace
      const graphsByWorkspace = { ...this.state.graphsByWorkspace }
      graphsByWorkspace[workspaceId] = {
        nodes: [],
        edges: [],
        selectedNodeId: null,
        selectedTemplateId: null,
      }
      this.setState({ graphsByWorkspace })
    }
    return this.state.graphsByWorkspace[workspaceId]
  }

  // Getters
  getNodes(params: { workspaceId: string }): Node[] {
    const graph = this.getWorkspaceGraph(params.workspaceId)
    return graph.nodes
  }

  getEdges(params: { workspaceId: string }): Edge[] {
    const graph = this.getWorkspaceGraph(params.workspaceId)
    return graph.edges
  }

  getGraph(params: { workspaceId: string }): { nodes: Node[]; edges: Edge[] } {
    console.log('[FlowGraphService.getGraph] Getting graph for workspace:', params.workspaceId, 'Available workspaces:', Object.keys(this.state.graphsByWorkspace))
    const graph = this.getWorkspaceGraph(params.workspaceId)
    console.log('[FlowGraphService.getGraph] Returning graph with nodeCount:', graph.nodes.length, 'edgeCount:', graph.edges.length)

    // Log sample node to see what's stored
    if (graph.nodes.length > 0) {
      const sampleNode = graph.nodes[0]
      console.log('[FlowGraphService.getGraph] Sample node:', {
        id: sampleNode.id,
        type: sampleNode.type,
        nodeType: (sampleNode as any).nodeType,
        dataNodeType: sampleNode.data?.nodeType,
        dataKeys: sampleNode.data ? Object.keys(sampleNode.data) : []
      })
    }

    // Log nodes with config
    const nodesWithConfig = graph.nodes.filter((n: any) => n.data?.config && Object.keys(n.data.config).length > 0)
    console.log('[FlowGraphService.getGraph] Nodes with config:', nodesWithConfig.map((n: any) => ({
      id: n.id,
      nodeType: n.data?.nodeType,
      config: n.data?.config
    })))

    return {
      nodes: graph.nodes,
      edges: graph.edges,
    }
  }

  getSelectedNodeId(params: { workspaceId: string }): string | null {
    const graph = this.getWorkspaceGraph(params.workspaceId)
    return graph.selectedNodeId
  }

  getSelectedTemplateId(params: { workspaceId: string }): string | null {
    const graph = this.getWorkspaceGraph(params.workspaceId)
    return graph.selectedTemplateId
  }

  getNode(params: { workspaceId: string; nodeId: string }): Node | undefined {
    const graph = this.getWorkspaceGraph(params.workspaceId)
    return graph.nodes.find((n) => n.id === params.nodeId)
  }

  /**
   * Set the graph (called when user saves in renderer or loads a template)
   * This is the "committed" graph that the scheduler will read
   */
  setGraph(params: { workspaceId: string; nodes: Node[]; edges: Edge[]; templateId?: string; reason?: FlowGraphChangeReason }): void {
    const { workspaceId, nodes, edges, templateId, reason = 'unknown' } = params

    console.log('[FlowGraph] Setting graph:', {
      workspaceId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      templateId: templateId || '(unchanged)',
    })

    // Log sample node to see what's being stored
    if (nodes && nodes.length > 0) {
      const sampleNode = nodes[0]
      console.log('[FlowGraph] Sample node being stored:', {
        id: sampleNode.id,
        type: sampleNode.type,
        nodeType: (sampleNode.data as any)?.nodeType,
        hasData: !!sampleNode.data,
        dataKeys: sampleNode.data ? Object.keys(sampleNode.data) : []
      })
    }

    this.pendingReasons[workspaceId] = reason

    const graphsByWorkspace = { ...this.state.graphsByWorkspace }
    const currentGraph = this.getWorkspaceGraph(workspaceId)
    graphsByWorkspace[workspaceId] = {
      ...currentGraph,
      nodes,
      edges,
      // Only update selectedTemplateId if explicitly provided
      selectedTemplateId: templateId !== undefined ? templateId : currentGraph.selectedTemplateId,
    }

    this.setState({ graphsByWorkspace })
  }

  /**
   * Set selected node
   */
  setSelectedNodeId(params: { workspaceId: string; id: string | null }): void {
    const { workspaceId, id } = params

    const graphsByWorkspace = { ...this.state.graphsByWorkspace }
    graphsByWorkspace[workspaceId] = {
      ...this.getWorkspaceGraph(workspaceId),
      selectedNodeId: id,
    }

    this.setState({ graphsByWorkspace })
  }

  /**
   * Update node label
   */
  setNodeLabel(params: { workspaceId: string; id: string; label: string }): void {
    const { workspaceId, id, label } = params
    const graph = this.getWorkspaceGraph(workspaceId)

    const nodes = graph.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, label } } : n
    )

    const graphsByWorkspace = { ...this.state.graphsByWorkspace }
    graphsByWorkspace[workspaceId] = {
      ...graph,
      nodes,
    }

    this.setState({ graphsByWorkspace })
  }

  /**
   * Patch node config
   */
  patchNodeConfig(params: { workspaceId: string; id: string; patch: Record<string, any> }): void {
    const { workspaceId, id, patch } = params
    const graph = this.getWorkspaceGraph(workspaceId)

    const nodes = graph.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
    )

    const graphsByWorkspace = { ...this.state.graphsByWorkspace }
    graphsByWorkspace[workspaceId] = {
      ...graph,
      nodes,
    }

    this.setState({ graphsByWorkspace })
  }

  /**
   * Clear the graph for a workspace
   */
  clearGraph(params: { workspaceId: string }): void {
    const { workspaceId } = params

    const graphsByWorkspace = { ...this.state.graphsByWorkspace }
    graphsByWorkspace[workspaceId] = {
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedTemplateId: null,
    }

    this.setState({ graphsByWorkspace })
  }
}

