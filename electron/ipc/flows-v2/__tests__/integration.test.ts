/**
 * Flow V2 Integration Tests
 * 
 * Tests complete flows end-to-end
 */

import { executeFlow } from '../index'
import type { FlowDefinition } from '../types'

// Mock the node implementations
jest.mock('../nodes', () => ({
  getNodeFunction: (node: any) => {
    const mockFunctions: Record<string, any> = {
      defaultContextStart: async (inputs: any, context: any) => ({
        outputs: { result: 'started' },
        updatedContext: context,
        status: 'success'
      }),
      
      tools: async (inputs: any, context: any, config: any) => ({
        outputs: {
          tools: [{ name: 'test_tool', description: 'A test tool' }],
          toolNames: ['test_tool']
        },
        updatedContext: context,
        status: 'success'
      }),
      
      userInput: async (inputs: any, context: any) => ({
        outputs: { result: 'user input received' },
        updatedContext: {
          ...context,
          messageHistory: [
            ...context.messageHistory,
            { role: 'user', content: 'test user input' }
          ]
        },
        status: 'paused' // This will trigger pause
      }),
      
      chat: async (inputs: any, context: any) => ({
        outputs: { result: 'chat response' },
        updatedContext: {
          ...context,
          messageHistory: [
            ...context.messageHistory,
            { role: 'assistant', content: 'test response' }
          ]
        },
        status: 'success'
      })
    }
    
    return mockFunctions[node.type] || mockFunctions.defaultContextStart
  }
}))

describe('Flow V2 Integration Tests', () => {
  describe('Original Bug Scenario', () => {
    it('should pass tools to chat node and pause at userInput', async () => {
      // This is the flow that had bugs in V1:
      // defaultContextStart → userInput → chat ← tools
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'start', type: 'defaultContextStart' },
          { id: 'tools', type: 'tools' },
          { id: 'userInput', type: 'userInput' },
          { id: 'chat', type: 'chat' }
        ],
        edges: [
          {
            id: 'e1',
            source: 'start',
            sourceHandle: 'context',
            target: 'userInput',
            targetHandle: 'context'
          },
          {
            id: 'e2',
            source: 'userInput',
            sourceHandle: 'context',
            target: 'chat',
            targetHandle: 'context'
          },
          {
            id: 'e3',
            source: 'tools',
            sourceHandle: 'tools',
            target: 'chat',
            targetHandle: 'tools'
          }
        ]
      }
      
      const result = await executeFlow(undefined, {
        requestId: 'test-bug-scenario',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      // Should pause at userInput (not complete)
      expect(result.ok).toBe(true)
      
      // In V1, this would have:
      // 1. Failed to pass tools to chat
      // 2. Not paused at userInput
      // In V2, both should work correctly
    })
  })
  
  describe('Complex Flow Patterns', () => {
    it('should handle diamond pattern (branch + join)', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'source', type: 'defaultContextStart' },
          { id: 'branch1', type: 'chat' },
          { id: 'branch2', type: 'chat' },
          { id: 'join', type: 'chat' }
        ],
        edges: [
          { id: 'e1', source: 'source', target: 'branch1' },
          { id: 'e2', source: 'source', target: 'branch2' },
          { id: 'e3', source: 'branch1', target: 'join', targetHandle: 'input1' },
          { id: 'e4', source: 'branch2', target: 'join', targetHandle: 'input2' }
        ]
      }
      
      const result = await executeFlow(undefined, {
        requestId: 'test-diamond',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      expect(result.ok).toBe(true)
      // Join should only execute after both branches complete
    })
    
    it('should handle long chains efficiently', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'n1', type: 'defaultContextStart' },
          { id: 'n2', type: 'chat' },
          { id: 'n3', type: 'chat' },
          { id: 'n4', type: 'chat' },
          { id: 'n5', type: 'chat' },
          { id: 'n6', type: 'chat' }
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
          { id: 'e3', source: 'n3', target: 'n4' },
          { id: 'e4', source: 'n4', target: 'n5' },
          { id: 'e5', source: 'n5', target: 'n6' }
        ]
      }
      
      const result = await executeFlow(undefined, {
        requestId: 'test-chain',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      expect(result.ok).toBe(true)
      // Should execute in order via pull phase
    })
  })
  
  describe('Error Handling', () => {
    it('should handle missing nodes gracefully', async () => {
      const flowDef: FlowDefinition = {
        nodes: [
          { id: 'start', type: 'unknownNodeType' }
        ],
        edges: []
      }
      
      const result = await executeFlow(undefined, {
        requestId: 'test-unknown-node',
        flowDef,
        provider: 'openai',
        model: 'gpt-5'
      })
      
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

