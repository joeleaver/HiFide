/**
 * Cache Node Tests
 *
 * Tests the cache node's ability to cache data and respect TTL settings.
 */

import { cacheNode, clearCache } from '../cache'
import { createTestContext, createTestConfig } from '../../../../__tests__/utils/testHelpers'

describe('Cache Node', () => {
  // Note: Badge emission is tested separately in integration tests
  // These unit tests focus on core caching logic

  // Clear cache before each test to ensure isolation
  beforeEach(() => {
    clearCache()
  })

  describe('Basic Caching', () => {
    it('should cache data on first execution', async () => {
      const context = createTestContext()
      const config = createTestConfig({
        ttl: 300 // 5 minutes
      })
      const testData = { message: 'Hello, World!' }

      const result = await cacheNode(context, testData, {}, config)

      expect(result.status).toBe('success')
      expect(result.data).toEqual(testData)
      expect(result.metadata?.cached).toBe(false) // First execution is not cached
    })

    it('should return cached data on second execution within TTL', async () => {
      const context = createTestContext()
      const config = createTestConfig({
        ttl: 300 // 5 minutes
      })
      const testData = { message: 'Cached data' }

      // First execution - cache miss
      const result1 = await cacheNode(context, testData, {}, config)
      expect(result1.metadata?.cached).toBe(false)

      // Second execution - cache hit
      const result2 = await cacheNode(context, testData, {}, config)
      expect(result2.status).toBe('success')
      expect(result2.data).toEqual(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should pass through context unchanged', async () => {
      const context = createTestContext({
        provider: 'openai',
        model: 'gpt-4o-mini',
        messageHistory: [
          { role: 'user', content: 'Test message' }
        ]
      })
      const config = createTestConfig({ ttl: 300 })
      const testData = 'test data'

      const result = await cacheNode(context, testData, {}, config)

      expect(result.context).toEqual(context)
      expect(result.context.provider).toBe('openai')
      expect(result.context.model).toBe('gpt-4o-mini')
      expect(result.context.messageHistory).toHaveLength(1)
    })
  })

  describe('TTL Behavior', () => {
    it('should not cache when TTL is 0', async () => {
      const context = createTestContext()
      const config = createTestConfig({
        ttl: 0 // Caching disabled
      })
      const testData = 'no cache'

      // First execution
      const result1 = await cacheNode(context, testData, {}, config)
      expect(result1.metadata?.cached).toBe(false)

      // Second execution - should still not be cached
      const result2 = await cacheNode(context, testData, {}, config)
      expect(result2.metadata?.cached).toBe(false)
    })

    it('should use default TTL of 300 seconds when not specified', async () => {
      const context = createTestContext()
      const config = createTestConfig({
        // No TTL specified - should default to 300
      })
      const testData = 'default ttl'

      // First execution
      const result1 = await cacheNode(context, testData, {}, config)
      expect(result1.metadata?.cached).toBe(false)

      // Second execution - should be cached
      const result2 = await cacheNode(context, testData, {}, config)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should expire cache after TTL', async () => {
      const context = createTestContext()
      const config = createTestConfig({
        ttl: 1 // 1 second TTL
      })
      const testData = 'expires soon'

      // First execution - cache miss
      const result1 = await cacheNode(context, testData, {}, config)
      expect(result1.metadata?.cached).toBe(false)

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100))

      // Third execution - cache should be expired
      const result3 = await cacheNode(context, testData, {}, config)
      expect(result3.metadata?.cached).toBe(false)
    })
  })

  describe('Cache Invalidation', () => {
    it('should invalidate cache when invalidate timestamp is newer', async () => {
      const context = createTestContext()
      const config = createTestConfig({
        ttl: 300
      })
      const testData = 'invalidate me'

      // First execution - cache miss
      const result1 = await cacheNode(context, testData, {}, config)
      expect(result1.metadata?.cached).toBe(false)

      // Second execution - cache hit
      const result2 = await cacheNode(context, testData, {}, config)
      expect(result2.metadata?.cached).toBe(true)

      // Invalidate cache by setting invalidate timestamp
      const configWithInvalidate = createTestConfig({
        ...config,
        invalidate: Date.now()
      })

      // Third execution - cache should be invalidated
      const result3 = await cacheNode(context, testData, {}, configWithInvalidate)
      expect(result3.metadata?.cached).toBe(false)
    })
  })

  describe('Different Data Types', () => {
    it('should cache string data', async () => {
      const context = createTestContext()
      const config = createTestConfig({ ttl: 300 })
      const testData = 'string data'

      const result1 = await cacheNode(context, testData, {}, config)
      const result2 = await cacheNode(context, testData, {}, config)

      expect(result2.data).toBe(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should cache object data', async () => {
      const context = createTestContext()
      const config = createTestConfig({ ttl: 300 })
      const testData = { key: 'value', nested: { data: 123 } }

      const result1 = await cacheNode(context, testData, {}, config)
      const result2 = await cacheNode(context, testData, {}, config)

      expect(result2.data).toEqual(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should cache array data', async () => {
      const context = createTestContext()
      const config = createTestConfig({ ttl: 300 })
      const testData = [1, 2, 3, 'four', { five: 5 }]

      const result1 = await cacheNode(context, testData, {}, config)
      const result2 = await cacheNode(context, testData, {}, config)

      expect(result2.data).toEqual(testData)
      expect(result2.metadata?.cached).toBe(true)
    })

    it('should cache null and undefined', async () => {
      const context = createTestContext()
      const config1 = createTestConfig({ ttl: 300, _nodeId: 'cache-null' })
      const config2 = createTestConfig({ ttl: 300, _nodeId: 'cache-undefined' })

      // Test null
      const result1 = await cacheNode(context, null, {}, config1)
      const result2 = await cacheNode(context, null, {}, config1)
      expect(result2.data).toBeNull()
      expect(result2.metadata?.cached).toBe(true)

      // Test undefined
      const result3 = await cacheNode(context, undefined, {}, config2)
      const result4 = await cacheNode(context, undefined, {}, config2)
      expect(result4.data).toBeUndefined()
      expect(result4.metadata?.cached).toBe(true)
    })
  })

  describe('Multiple Cache Nodes', () => {
    it('should maintain separate caches for different node IDs', async () => {
      const context = createTestContext()
      const config1 = createTestConfig({ ttl: 300, _nodeId: 'cache-1' })
      const config2 = createTestConfig({ ttl: 300, _nodeId: 'cache-2' })
      const data1 = 'data for cache 1'
      const data2 = 'data for cache 2'

      // Cache data in node 1
      await cacheNode(context, data1, {}, config1)
      const result1 = await cacheNode(context, data1, {}, config1)
      expect(result1.data).toBe(data1)
      expect(result1.metadata?.cached).toBe(true)

      // Cache data in node 2
      await cacheNode(context, data2, {}, config2)
      const result2 = await cacheNode(context, data2, {}, config2)
      expect(result2.data).toBe(data2)
      expect(result2.metadata?.cached).toBe(true)

      // Verify they're independent
      expect(result1.data).not.toBe(result2.data)
    })
  })
})

