/**
 * Tests for scheduler context isolation
 *
 * Verifies that the scheduler correctly preserves provider/model settings
 * for isolated contexts created by newContext nodes, while still allowing
 * mid-flow switching for main contexts.
 */

import { FlowScheduler } from '../scheduler'
import type { FlowDefinition } from '../types'

import { waitFor } from '../../../__tests__/utils/testHelpers'


// Mock llm-service to avoid real network calls and API keys
jest.mock('../llm-service', () => {
  return {
    llmService: {
      chat: async ({ message, context, flowAPI }: any) => {
        // Emit a small chunk and usage, then succeed
        try { flowAPI.emitExecutionEvent({ type: 'chunk', provider: context.provider, model: context.model, text: 'ok' }) } catch {}
        return {
          text: 'ok',
          updatedContext: {
            ...context,
            messageHistory: [...(context.messageHistory || []), { role: 'assistant', content: 'ok' }]
          }
        }
      }
    }
  }
})

describe('Scheduler Context Isolation', () => {
  describe('Isolated Context Preservation', () => {
    it('should preserve provider/model from newContext node', async () => {
      // Create a simple flow:
      // newContext (gemini/gemini-2.0-flash-exp) -> llmRequest
      const flowDef: FlowDefinition = {
        nodes: [
          {
            id: 'defaultContextStart-1',
            nodeType: 'defaultContextStart',
            config: {},
            position: { x: 0, y: 0 }
          },
          {
            id: 'newContext-1',
            nodeType: 'newContext',
            config: {
              provider: 'gemini',
              model: 'gemini-2.0-flash-exp',
              systemInstructions: 'Test isolated context'
            },
            position: { x: 100, y: 0 }
          },
          {
            id: 'manualInput-1',
            nodeType: 'manualInput',
            config: { message: 'Test message' },
            position: { x: 200, y: 0 }
          },
          {
            id: 'llmRequest-1',
            nodeType: 'llmRequest',
            config: {},
            position: { x: 300, y: 0 }
          }
        ],
        edges: [
          {
            id: 'edge-0',
            source: 'defaultContextStart-1',
            target: 'newContext-1',
            sourceHandle: 'context',
            targetHandle: 'context'
          },
          {
            id: 'edge-1',
            source: 'newContext-1',
            target: 'llmRequest-1',
            sourceHandle: 'context',
            targetHandle: 'context'
          },
          {
            id: 'edge-2',
            source: 'manualInput-1',
            target: 'llmRequest-1',
            sourceHandle: 'data',
            targetHandle: 'data'
          }
        ]
      }

      // Create scheduler with session context
      const scheduler = new FlowScheduler(
        undefined, // no webContents
        'test-request-id',
        flowDef,
        {
          requestId: 'test-request-id',
          flowDef,
          initialContext: {
            provider: 'openai',
            model: 'gpt-4o',
            messageHistory: []
          }
        }
      )

      // Mock the node execution to capture the context
      let capturedContext: any = null
      const originalExecuteNode = (scheduler as any).doExecuteNode.bind(scheduler)
      ;(scheduler as any).doExecuteNode = async function(nodeId: string, pushedInputs: any, callerId: any, isPull: boolean) {
        // Capture context immediately on entry so we don't miss it if the node throws
        if (nodeId === 'llmRequest-1' && pushedInputs && pushedInputs.context) {
          capturedContext = pushedInputs.context
        }
        return originalExecuteNode(nodeId, pushedInputs, callerId, isPull)
      }

      // Execute the flow (will fail at llmRequest since we don't have real LLM, but that's OK)
      // Execute without failing the test on expected downstream llmRequest error
      void scheduler.execute().catch(() => {})
      await waitFor(() => !!capturedContext, 5000)

      // Verify that the isolated context preserved its provider/model
      expect(capturedContext).toBeDefined()
      expect(capturedContext.provider).toBe('gemini')
      expect(capturedContext.model).toBe('gemini-2.0-flash-exp')
      expect(capturedContext.contextType).toBe('isolated')
    })

    it('should preserve provider/model from initial session context for main flows', async () => {
      // Create a simple flow:
      // defaultContextStart -> llmRequest
      const flowDef: FlowDefinition = {
        nodes: [
          {
            id: 'defaultContextStart-1',
            nodeType: 'defaultContextStart',
            config: {
              systemInstructions: 'Test main context'
            },
            position: { x: 0, y: 0 }
          },
          {
            id: 'manualInput-1',
            nodeType: 'manualInput',
            config: { message: 'Test message' },
            position: { x: 50, y: 0 }
          },
          {
            id: 'llmRequest-1',
            nodeType: 'llmRequest',
            config: {},
            position: { x: 150, y: 0 }
          }
        ],
        edges: [
          {
            id: 'edge-1',
            source: 'defaultContextStart-1',
            target: 'llmRequest-1',
            sourceHandle: 'context',
            targetHandle: 'context'
          },
          {
            id: 'edge-2',
            source: 'manualInput-1',
            target: 'llmRequest-1',
            sourceHandle: 'data',
            targetHandle: 'data'
          }
        ]
      }

      // Create scheduler with session context
      const scheduler = new FlowScheduler(
        undefined,
        'test-request-id',
        flowDef,
        {
          requestId: 'test-request-id',
          flowDef,
          initialContext: {
            provider: 'anthropic',
            model: 'claude-3-5-sonnet-20241022',
            messageHistory: []
          }
        }
      )

      // Mock the node execution to capture the context
      let capturedContext: any = null
      const originalExecuteNode = (scheduler as any).doExecuteNode.bind(scheduler)
      ;(scheduler as any).doExecuteNode = async function(nodeId: string, pushedInputs: any, callerId: any, isPull: boolean) {
        if (nodeId === 'llmRequest-1' && pushedInputs && pushedInputs.context) {
          capturedContext = pushedInputs.context
        }
        return originalExecuteNode(nodeId, pushedInputs, callerId, isPull)
      }

      // Execute the flow
      // Execute without failing the test on expected downstream llmRequest error
      void scheduler.execute().catch(() => {})
      await waitFor(() => !!capturedContext, 5000)

      // Verify that the main context uses the session's provider/model
      expect(capturedContext).toBeDefined()
      expect(capturedContext.provider).toBe('anthropic')
      expect(capturedContext.model).toBe('claude-3-5-sonnet-20241022')
      expect(capturedContext.contextType).toBe('main')
    })
  })

  describe('Context Type Detection', () => {
    it('should treat undefined contextType as main context', async () => {
      // Create a flow where context doesn't have explicit contextType
      const flowDef: FlowDefinition = {
        nodes: [
          {
            id: 'defaultContextStart-1',
            nodeType: 'defaultContextStart',
            config: {},
            position: { x: 0, y: 0 }
          },
          {
            id: 'manualInput-1',
            nodeType: 'manualInput',
            config: { message: 'Test message' },
            position: { x: 50, y: 0 }
          },
          {
            id: 'llmRequest-1',
            nodeType: 'llmRequest',
            config: {},
            position: { x: 150, y: 0 }
          }
        ],
        edges: [
          {
            id: 'edge-1',
            source: 'defaultContextStart-1',
            target: 'llmRequest-1',
            sourceHandle: 'context',
            targetHandle: 'context'
          },
          {
            id: 'edge-2',
            source: 'manualInput-1',
            target: 'llmRequest-1',
            sourceHandle: 'data',
            targetHandle: 'data'
          }
        ]
      }

      const scheduler = new FlowScheduler(
        undefined,
        'test-request-id',
        flowDef,
        {
          requestId: 'test-request-id',
          flowDef,
          initialContext: {
            provider: 'openai',
            model: 'gpt-4o',
            messageHistory: []
          }
        }
      )

      // Mock to capture context
      let capturedContext: any = null
      const originalExecuteNode = (scheduler as any).doExecuteNode.bind(scheduler)
      ;(scheduler as any).doExecuteNode = async function(nodeId: string, pushedInputs: any, callerId: any, isPull: boolean) {
        if (nodeId === 'llmRequest-1' && pushedInputs && pushedInputs.context) {
          capturedContext = pushedInputs.context
        }
        return originalExecuteNode(nodeId, pushedInputs, callerId, isPull)
      }

      // Execute without failing the test on expected downstream llmRequest error
      void scheduler.execute().catch(() => {})
      await waitFor(() => !!capturedContext, 5000)

      // Should inject provider/model since contextType is undefined (treated as main)
      expect(capturedContext).toBeDefined()
      expect(capturedContext.provider).toBe('openai')
      expect(capturedContext.model).toBe('gpt-4o')
    })
  })
})

