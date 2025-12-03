/**
 * Cache Node Tests
 *
 * Tests the cache node's ability to cache data and respect TTL settings.
 */

import { cacheNode, clearCache } from '../cache'
import {
  createMainFlowContext,
  createTestConfig,
  createMockFlowAPI,
  createMockNodeInputs
} from '../../../__tests__/utils/testHelpers'

describe('Cache Node', () => {
  // Note: Badge emission is tested separately in integration tests
  // These unit tests focus on core caching logic

  // Clear in-memory cache before each test
  beforeEach(() => {
    clearCache()
  })

  describe('Basic Caching', () => {
    it('should cache data on first execution', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        ttl: 300 // 5 minutes
      })
      const testData = { message: 'Hello, World!' }
      const inputs = createMockNodeInputs({ data: testData })

      const result = await cacheNode(flow, context, undefined, inputs, config)

      expect(result.status).toBe('success')
      expect(result.data).toEqual(testData)
      expect(result.metadata?.cached).toBe(false) // First execution is not cached

      // Verify cache was set
      expect(flow.store.setNodeCache).toHaveBeenCalled()
    })

    it('should return cached data on second execution within TTL', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        ttl: 300 // 5 minutes
      })
      const testData = { message: 'Cached data' }
      const inputs = createMockNodeInputs({ data: testData })

      // First execution - cache miss
      const result1 = await cacheNode(flow, context, undefined, inputs, config)
      expect(result1.metadata?.cached).toBe(false)

      // Mock cache hit for second execution
      const cachedData = {
        data: testData,
        timestamp: Date.now()
      }
      flow.store.getNodeCache = jest.fn(() => cachedData)

      // Second execution - cache hit (should NOT pull from inputs)
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)
      expect(result2.status).toBe('success')
      expect(result2.data).toEqual(testData)
      expect(result2.metadata?.cached).toBe(true)

      // Verify inputs.pull was NOT called (lazy evaluation)
      expect(inputs2.pull).not.toHaveBeenCalled()
    })

    it('should pass through context unchanged', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext({
        provider: 'openai',
        model: 'gpt-4o-mini',
        messageHistory: [
          { role: 'user', content: 'Test message' }
        ]
      })
      const config = createTestConfig({ ttl: 300 })
      const testData = 'test data'
      const inputs = createMockNodeInputs({ data: testData })

      const result = await cacheNode(flow, context, undefined, inputs, config)

      expect(result.context).toEqual(context)
      expect(result.context.provider).toBe('openai')
      expect(result.context.model).toBe('gpt-4o-mini')
      expect(result.context.messageHistory).toHaveLength(1)
    })
  })

  describe('TTL Behavior', () => {
    it('should not cache when TTL is 0', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        ttl: 0 // Caching disabled
      })
      const testData = 'no cache'
      const inputs = createMockNodeInputs({ data: testData })

      // First execution
      const result1 = await cacheNode(flow, context, undefined, inputs, config)
      expect(result1.metadata?.cached).toBe(false)

      // Second execution - should still not be cached
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)
      expect(result2.metadata?.cached).toBe(false)

      // Verify cache was never set
      expect(flow.store.setNodeCache).not.toHaveBeenCalled()
    })

    it('should use default TTL of 300 seconds when not specified', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        // No TTL specified - should default to 300
      })
      const testData = 'default ttl'
      const inputs = createMockNodeInputs({ data: testData })

      // First execution
      const result1 = await cacheNode(flow, context, undefined, inputs, config)
      expect(result1.metadata?.cached).toBe(false)

      // Mock cache hit for second execution
      const cachedData = {
        data: testData,
        timestamp: Date.now()
      }
      flow.store.getNodeCache = jest.fn(() => cachedData)

      // Second execution - should be cached
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should expire cache after TTL', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        ttl: 1 // 1 second TTL
      })
      const testData = 'expires soon'
      const inputs = createMockNodeInputs({ data: testData })

      // First execution - cache miss
      const result1 = await cacheNode(flow, context, undefined, inputs, config)
      expect(result1.metadata?.cached).toBe(false)

      // Mock expired cache for third execution
      const expiredCache = {
        data: testData,
        timestamp: Date.now() - 2000 // 2 seconds ago (expired)
      }
      flow.store.getNodeCache = jest.fn(() => expiredCache)

      // Third execution - cache should be expired
      const inputs3 = createMockNodeInputs({ data: testData })
      const result3 = await cacheNode(flow, context, undefined, inputs3, config)
      expect(result3.metadata?.cached).toBe(false)
    })
  })

  describe('Cache Invalidation', () => {
    it('should invalidate cache when invalidate timestamp is newer', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({
        ttl: 300
      })
      const testData = 'invalidate me'
      const inputs = createMockNodeInputs({ data: testData })

      // First execution - cache miss
      const result1 = await cacheNode(flow, context, undefined, inputs, config)
      expect(result1.metadata?.cached).toBe(false)

      // Mock cache hit for second execution
      const cachedData = {
        data: testData,
        timestamp: Date.now() - 1000 // 1 second ago
      }
      flow.store.getNodeCache = jest.fn(() => cachedData)

      // Second execution - cache hit
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)
      expect(result2.metadata?.cached).toBe(true)

      // Invalidate cache by setting invalidate timestamp
      const configWithInvalidate = createTestConfig({
        ...config,
        invalidate: Date.now() // Newer than cache timestamp
      })

      // Third execution - cache should be invalidated
      const inputs3 = createMockNodeInputs({ data: testData })
      const result3 = await cacheNode(flow, context, undefined, inputs3, configWithInvalidate)
      expect(result3.metadata?.cached).toBe(false)
    })
  })

  describe('Different Data Types', () => {
    it('should cache string data', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({ ttl: 300 })
      const testData = 'string data'
      const inputs = createMockNodeInputs({ data: testData })

      const result1 = await cacheNode(flow, context, undefined, inputs, config)

      // Mock cache hit
      flow.store.getNodeCache = jest.fn(() => ({ data: testData, timestamp: Date.now() }))
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)

      expect(result2.data).toBe(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should cache object data', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({ ttl: 300 })
      const testData = { key: 'value', nested: { data: 123 } }
      const inputs = createMockNodeInputs({ data: testData })

      const result1 = await cacheNode(flow, context, undefined, inputs, config)

      // Mock cache hit
      flow.store.getNodeCache = jest.fn(() => ({ data: testData, timestamp: Date.now() }))
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)

      expect(result2.data).toEqual(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should cache array data', async () => {
      const flow = createMockFlowAPI()
      const context = createMainFlowContext()
      const config = createTestConfig({ ttl: 300 })
      const testData = [1, 2, 3, 'four', { five: 5 }]
      const inputs = createMockNodeInputs({ data: testData })

      const result1 = await cacheNode(flow, context, undefined, inputs, config)

      // Mock cache hit
      flow.store.getNodeCache = jest.fn(() => ({ data: testData, timestamp: Date.now() }))
      const inputs2 = createMockNodeInputs({ data: testData })
      const result2 = await cacheNode(flow, context, undefined, inputs2, config)

      expect(result2.data).toEqual(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should cache null and undefined', async () => {
      const flow1 = createMockFlowAPI({ nodeId: 'cache-null' })
      const flow2 = createMockFlowAPI({ nodeId: 'cache-undefined' })
      const context = createMainFlowContext()
      const config1 = createTestConfig({ ttl: 300, _nodeId: 'cache-null' })
      const config2 = createTestConfig({ ttl: 300, _nodeId: 'cache-undefined' })

      // Test null
      const inputs1 = createMockNodeInputs({ data: null })
      const result1 = await cacheNode(flow1, context, undefined, inputs1, config1)

      flow1.store.getNodeCache = jest.fn(() => ({ data: null, timestamp: Date.now() }))
      const inputs2 = createMockNodeInputs({ data: null })
      const result2 = await cacheNode(flow1, context, undefined, inputs2, config1)
      expect(result2.data).toBeNull()
      expect(result2.metadata?.cached).toBe(true)

      // Test undefined
      const inputs3 = createMockNodeInputs({ data: undefined })
      const result3 = await cacheNode(flow2, context, undefined, inputs3, config2)

      flow2.store.getNodeCache = jest.fn(() => ({ data: undefined, timestamp: Date.now() }))
      const inputs4 = createMockNodeInputs({ data: undefined })
      const result4 = await cacheNode(flow2, context, undefined, inputs4, config2)
      expect(result4.data).toBeUndefined()
      expect(result4.metadata?.cached).toBe(true)
    })
  })

  describe('Multiple Cache Nodes', () => {
    it('should maintain separate caches for different node IDs', async () => {
      const flow1 = createMockFlowAPI({ nodeId: 'cache-1' })
      const flow2 = createMockFlowAPI({ nodeId: 'cache-2' })
      const context = createMainFlowContext()
      const config1 = createTestConfig({ ttl: 300, _nodeId: 'cache-1' })
      const config2 = createTestConfig({ ttl: 300, _nodeId: 'cache-2' })
      const data1 = 'data for cache 1'
      const data2 = 'data for cache 2'

      // Cache data in node 1
      const inputs1a = createMockNodeInputs({ data: data1 })
      await cacheNode(flow1, context, undefined, inputs1a, config1)

      flow1.store.getNodeCache = jest.fn(() => ({ data: data1, timestamp: Date.now() }))
      const inputs1b = createMockNodeInputs({ data: data1 })
      const result1 = await cacheNode(flow1, context, undefined, inputs1b, config1)
      expect(result1.data).toBe(data1)
      expect(result1.metadata?.cached).toBe(true)

      // Cache data in node 2
      const inputs2a = createMockNodeInputs({ data: data2 })
      await cacheNode(flow2, context, undefined, inputs2a, config2)

      flow2.store.getNodeCache = jest.fn(() => ({ data: data2, timestamp: Date.now() }))
      const inputs2b = createMockNodeInputs({ data: data2 })
      const result2 = await cacheNode(flow2, context, undefined, inputs2b, config2)
      expect(result2.data).toBe(data2)
      expect(result2.metadata?.cached).toBe(true)

      // Verify they're independent
      expect(result1.data).not.toBe(result2.data)
    })
  })
})

