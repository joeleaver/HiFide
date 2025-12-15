import { computeGraphSignature, sanitizeGraphSnapshot } from '../flowEditorLocalTransforms'

describe('flowEditorLocalTransforms', () => {
  it('strips runtime-only node fields from sanitized snapshots', () => {
    const nodes = [
      {
        id: 'node-1',
        type: 'hifiNode',
        position: { x: 10, y: 20 },
        selected: true,
        __rf: { width: 100, height: 40 },
        data: {
          nodeType: 'defaultContextStart',
          config: { foo: 'bar' },
          status: 'running',
          onConfigChange: () => {},
        },
      },
    ]
    const edges = [
      {
        id: 'edge-1',
        source: 'a',
        target: 'b',
        selected: true,
        __rf: { distance: 42 },
        data: { status: 'active' },
      },
    ]

    const sanitized = sanitizeGraphSnapshot(nodes as any, edges as any)

    expect(sanitized.nodes[0]).not.toHaveProperty('__rf')
    expect(sanitized.nodes[0]).not.toHaveProperty('selected')
    expect(sanitized.nodes[0].data).toEqual({ nodeType: 'defaultContextStart', config: { foo: 'bar' } })

    expect(sanitized.edges[0]).not.toHaveProperty('__rf')
    expect(sanitized.edges[0]).not.toHaveProperty('selected')
    expect(sanitized.edges[0].data).toEqual({})
  })

  it('produces identical signatures when only runtime fields differ', () => {
    const baseNode = {
      id: 'node-2',
      type: 'hifiNode',
      position: { x: 0, y: 0 },
      data: { nodeType: 'test', config: { value: 1 } },
    }

    const variantA = [{
      ...baseNode,
      selected: true,
      data: { ...baseNode.data, status: 'running' },
    }]

    const variantB = [{
      ...baseNode,
      dragging: true,
      data: { ...baseNode.data, cacheHit: true },
    }]

    const sigA = computeGraphSignature(variantA as any, [])
    const sigB = computeGraphSignature(variantB as any, [])

    expect(sigA).toBe(sigB)
  })
})
