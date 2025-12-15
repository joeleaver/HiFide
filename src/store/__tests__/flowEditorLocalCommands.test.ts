import { useFlowEditorLocal } from '../flowEditorLocal'

describe('flowEditorLocal command API', () => {
  beforeEach(() => {
    // Ensure actions are allowed during tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(useFlowEditorLocal as any).getState().reset()
  })

  it('updateNodeData patches node.data without destroying other fields', () => {
    useFlowEditorLocal.setState({
      nodes: [
        {
          id: 'n1',
          type: 'hifiNode',
          position: { x: 0, y: 0 },
          data: { nodeType: 'test', label: 'A', config: { a: 1 } },
        },
      ],
      edges: [],
      isHydrated: true,
    } as any)

    useFlowEditorLocal.getState().updateNodeData('n1', { label: 'B' })

    const n1 = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === 'n1')
    expect(n1.data.label).toBe('B')
    expect(n1.data.nodeType).toBe('test')
    expect(n1.data.config).toEqual({ a: 1 })
  })

  it('updateNodeConfig shallow-merges into node.data.config', () => {
    useFlowEditorLocal.setState({
      nodes: [
        {
          id: 'n1',
          type: 'hifiNode',
          position: { x: 0, y: 0 },
          data: { nodeType: 'test', config: { a: 1, b: 2 } },
        },
      ],
      edges: [],
      isHydrated: true,
    } as any)

    useFlowEditorLocal.getState().updateNodeConfig('n1', { b: 3, c: 4 })

    const n1 = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === 'n1')
    expect(n1.data.config).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('addEdge and removeEdgeById mutate edges list', () => {
    useFlowEditorLocal.setState({ nodes: [], edges: [], isHydrated: true } as any)

    useFlowEditorLocal.getState().addEdge({ id: 'e1', source: 'a', target: 'b' } as any)
    expect(useFlowEditorLocal.getState().edges).toHaveLength(1)

    useFlowEditorLocal.getState().removeEdgeById('e1')
    expect(useFlowEditorLocal.getState().edges).toHaveLength(0)
  })

  it('addNode adds node; removeNodeById removes node and connected edges', () => {
    useFlowEditorLocal.setState({ nodes: [], edges: [], isHydrated: true } as any)

    useFlowEditorLocal.getState().addNode({ id: 'n1', type: 'hifiNode', position: { x: 0, y: 0 }, data: {} } as any)
    useFlowEditorLocal.getState().addNode({ id: 'n2', type: 'hifiNode', position: { x: 0, y: 0 }, data: {} } as any)

    useFlowEditorLocal.getState().addEdge({ id: 'e1', source: 'n1', target: 'n2' } as any)
    useFlowEditorLocal.getState().addEdge({ id: 'e2', source: 'x', target: 'n1' } as any)

    expect(useFlowEditorLocal.getState().nodes).toHaveLength(2)
    expect(useFlowEditorLocal.getState().edges).toHaveLength(2)

    useFlowEditorLocal.getState().removeNodeById('n1')

    const nodeIds = useFlowEditorLocal.getState().nodes.map((n: any) => n.id)
    expect(nodeIds).toEqual(['n2'])
    expect(useFlowEditorLocal.getState().edges).toHaveLength(0)
  })

  it('applyNodeChanges applies reactflow change-set', () => {
    useFlowEditorLocal.setState({
      nodes: [{ id: 'n1', type: 'hifiNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
      isHydrated: true,
    } as any)

    useFlowEditorLocal.getState().applyNodeChanges([
      { id: 'n1', type: 'position', position: { x: 50, y: 75 } },
    ] as any)

    const n1 = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === 'n1')
    expect(n1.position).toEqual({ x: 50, y: 75 })
  })

  it('applyEdgeChanges applies reactflow change-set', () => {
    useFlowEditorLocal.setState({
      nodes: [],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      isHydrated: true,
    } as any)

    useFlowEditorLocal.getState().applyEdgeChanges([{ id: 'e1', type: 'remove' }] as any)
    expect(useFlowEditorLocal.getState().edges).toHaveLength(0)
  })
})
