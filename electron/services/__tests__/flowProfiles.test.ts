import type { Node, Edge } from 'reactflow'
import { saveFlowProfile, listFlowTemplates, loadFlowTemplate } from '../flowProfiles'

/**
 * Snapshot/shape tests for flow profile serialization
 */

describe('flowProfiles serialization', () => {
  it('saves minimal node/edge shape using nodeType and strips UI-only fields', async () => {
    const nodes: Node[] = [
      {
        id: 'llmRequest-1',
        type: 'hifiNode',
        position: { x: 1, y: 2 },
        // UI-only props that must be stripped
        width: 300,
        height: 200,
        selected: true,
        dragging: true,
        style: { background: 'red' },
        data: {
          nodeType: 'llmRequest',
          // intentionally include legacy field to ensure it is ignored
          kind: 'llmRequest',
          label: 'LLM',
          labelBase: 'LLM',
          config: { provider: 'openai', model: 'gpt-4o' },
          expanded: true,
        },
      } as any,
    ]

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'llmRequest-1',
        target: 'userInput-1',
        sourceHandle: 'data',
        targetHandle: 'context',
        // UI-only props that must be stripped
        style: { stroke: 'red' },
        animated: true,
        markerEnd: { type: 'arrowclosed' } as any,
        selected: true,
        type: 'smoothstep',
      } as any,
    ]

    const name = 'snapshot-test'
    const description = 'desc'

    const res = await saveFlowProfile(nodes, edges, name, description)
    expect(res.success).toBe(true)

    // Fetch template list and find our user-saved profile
    const templates = await listFlowTemplates()
    const user = templates.find((t) => t.id === name && t.library === 'user')
    expect(user).toBeDefined()

    // Verify minimal serialized shape (no UI-only props)
    expect(user!.profile).toMatchObject({
      name,
      description,
      version: expect.any(String),
      nodes: [
        {
          id: 'llmRequest-1',
          nodeType: 'llmRequest',
          label: 'LLM',
          position: { x: 1, y: 2 },
          expanded: true,
          // no UI-only props present
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'llmRequest-1',
          target: 'userInput-1',
          sourceHandle: 'data',
          targetHandle: 'context',
          // no UI-only props present
        },
      ],
    })

    // Ensure forbidden fields are absent
    const serNode = user!.profile.nodes[0] as any
    expect(serNode.kind).toBeUndefined()
    expect(serNode.width).toBeUndefined()
    expect(serNode.height).toBeUndefined()
    expect(serNode.selected).toBeUndefined()
    expect(serNode.positionAbsolute).toBeUndefined()
    expect(serNode.dragging).toBeUndefined()

    const serEdge = user!.profile.edges[0] as any
    expect(serEdge.style).toBeUndefined()
    expect(serEdge.animated).toBeUndefined()
    expect(serEdge.markerEnd).toBeUndefined()
    expect(serEdge.selected).toBeUndefined()
    expect(serEdge.type).toBeUndefined()
  })

  it('round-trips via loadFlowTemplate with data.nodeType present and no data.kind', async () => {
    const name = 'snapshot-test'
    const loaded = await loadFlowTemplate(name)
    expect(loaded).not.toBeNull()

    const { nodes, edges } = loaded!
    expect(nodes[0].type).toBe('hifiNode')
    const data: any = nodes[0].data
    expect(data.nodeType).toBe('llmRequest')
    expect(data.kind).toBeUndefined()

    expect(edges[0]).toMatchObject({
      id: 'edge-1',
      source: 'llmRequest-1',
      target: 'userInput-1',
      sourceHandle: 'data',
      targetHandle: 'context',
    })
  })
})

