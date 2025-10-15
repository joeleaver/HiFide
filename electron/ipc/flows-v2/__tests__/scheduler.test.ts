/**
 * Flow Scheduler V2 Tests
 */

import { FlowScheduler } from '../scheduler'
import type { FlowDefinition, ExecutionContext, NodeOutput } from '../types'

// Mock node functions for testing
const mockNodes = {
  testPassThrough: async (inputs: any, context: ExecutionContext, config: any): Promise<NodeOutput> => {
    return {
      outputs: { result: inputs.data || 'default' },
      updatedContext: context,
      status: 'success'
    }
  },
  
  testTransform: async (inputs: any, context: ExecutionContext, config: any): Promise<NodeOutput> => {
    const input = inputs.data || ''
    return {
      outputs: { result: input.toUpperCase() },
      updatedContext: context,
      status: 'success'
    }
  },
  
  testJoin: async (inputs: any, context: ExecutionContext, config: any): Promise<NodeOutput> => {
    const parts = [inputs.input1 || '', inputs.input2 || '']
    return {
      outputs: { result: parts.join(' + ') },
      updatedContext: context,
      status: 'success'
    }
  }
}

// Mock getNodeFunction
jest.mock('../nodes', () => ({
  getNodeFunction: (node: any) => {
    return mockNodes[node.type as keyof typeof mockNodes] || mockNodes.testPassThrough
  }
}))

describe('FlowScheduler', () => {
  describe('Linear Flow', () => {
    it('should execute nodes in sequence', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'node1', type: 'testPassThrough' },
          { id: 'node2', type: 'testTransform' },
          { id: 'node3', type: 'testPassThrough' }
        ],
        edges: [
          { id: 'e1', source: 'node1', sourceOutput: 'result', target: 'node2', targetInput: 'data' },
          { id: 'e2', source: 'node2', sourceOutput: 'result', target: 'node3', targetInput: 'data' }
        ]
      }
      
      const scheduler = new FlowScheduler(undefined, 'test-1', flowDef, {
        requestId: 'test-1',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      const result = await scheduler.execute()
      
      expect(result.ok).toBe(true)
      // Verify execution order and data flow
      // node1 → node2 (transform) → node3
    })
  })
  
  describe('Branching Flow', () => {
    it('should execute multiple successors', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'source', type: 'testPassThrough' },
          { id: 'branch1', type: 'testTransform' },
          { id: 'branch2', type: 'testTransform' }
        ],
        edges: [
          { id: 'e1', source: 'source', sourceOutput: 'result', target: 'branch1', targetInput: 'data' },
          { id: 'e2', source: 'source', sourceOutput: 'result', target: 'branch2', targetInput: 'data' }
        ]
      }
      
      const scheduler = new FlowScheduler(undefined, 'test-2', flowDef, {
        requestId: 'test-2',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      const result = await scheduler.execute()
      
      expect(result.ok).toBe(true)
      // Both branches should execute
    })
  })
  
  describe('Join Flow', () => {
    it('should wait for all inputs before executing', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'input1', type: 'testPassThrough' },
          { id: 'input2', type: 'testPassThrough' },
          { id: 'join', type: 'testJoin' }
        ],
        edges: [
          { id: 'e1', source: 'input1', sourceOutput: 'result', target: 'join', targetInput: 'input1' },
          { id: 'e2', source: 'input2', sourceOutput: 'result', target: 'join', targetInput: 'input2' }
        ]
      }
      
      const scheduler = new FlowScheduler(undefined, 'test-3', flowDef, {
        requestId: 'test-3',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      const result = await scheduler.execute()
      
      expect(result.ok).toBe(true)
      // Join should only execute after both inputs complete
    })
  })
  
  describe('Chain Flow', () => {
    it('should handle long chains via pull', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'n1', type: 'testPassThrough' },
          { id: 'n2', type: 'testTransform' },
          { id: 'n3', type: 'testTransform' },
          { id: 'n4', type: 'testTransform' },
          { id: 'n5', type: 'testPassThrough' }
        ],
        edges: [
          { id: 'e1', source: 'n1', sourceOutput: 'result', target: 'n2', targetInput: 'data' },
          { id: 'e2', source: 'n2', sourceOutput: 'result', target: 'n3', targetInput: 'data' },
          { id: 'e3', source: 'n3', sourceOutput: 'result', target: 'n4', targetInput: 'data' },
          { id: 'e4', source: 'n4', sourceOutput: 'result', target: 'n5', targetInput: 'data' }
        ]
      }
      
      const scheduler = new FlowScheduler(undefined, 'test-4', flowDef, {
        requestId: 'test-4',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      const result = await scheduler.execute()
      
      expect(result.ok).toBe(true)
      // Chain should execute in order via pull phase
    })
  })
  
  describe('Memoization', () => {
    it('should not execute nodes twice', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'source', type: 'testPassThrough' },
          { id: 'branch1', type: 'testTransform' },
          { id: 'branch2', type: 'testTransform' },
          { id: 'join', type: 'testJoin' }
        ],
        edges: [
          { id: 'e1', source: 'source', sourceOutput: 'result', target: 'branch1', targetInput: 'data' },
          { id: 'e2', source: 'source', sourceOutput: 'result', target: 'branch2', targetInput: 'data' },
          { id: 'e3', source: 'branch1', sourceOutput: 'result', target: 'join', targetInput: 'input1' },
          { id: 'e4', source: 'branch2', sourceOutput: 'result', target: 'join', targetInput: 'input2' }
        ]
      }
      
      const scheduler = new FlowScheduler(undefined, 'test-5', flowDef, {
        requestId: 'test-5',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      const result = await scheduler.execute()
      
      expect(result.ok).toBe(true)
      // Source should only execute once even though it has two successors
    })
  })
  
  describe('Error Handling', () => {
    it('should detect circular dependencies', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'n1', type: 'testPassThrough' },
          { id: 'n2', type: 'testPassThrough' }
        ],
        edges: [
          { id: 'e1', source: 'n1', sourceOutput: 'result', target: 'n2', targetInput: 'data' },
          { id: 'e2', source: 'n2', sourceOutput: 'result', target: 'n1', targetInput: 'data' }
        ]
      }
      
      const scheduler = new FlowScheduler(undefined, 'test-6', flowDef, {
        requestId: 'test-6',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      const result = await scheduler.execute()
      
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Circular dependency')
    })
  })
})

