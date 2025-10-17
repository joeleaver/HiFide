/**
 * Cache node
 *
 * Caches data from upstream nodes to avoid re-executing expensive operations.
 * Cache is in-memory and persists across flow executions (but not app restarts).
 *
 * Inputs:
 * - data: Data value to cache
 *
 * Outputs:
 * - data: Cached or fresh data
 *
 * Config:
 * - ttl: Time-to-live in seconds (0 = no caching, default: 300 = 5 minutes)
 * - invalidate: Trigger to invalidate cache (timestamp)
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Caches data from upstream nodes to avoid re-executing expensive operations.'
}

// In-memory cache storage (persists across flow executions)
// Key: nodeId, Value: { data, timestamp }
const cacheStorage = new Map<string, { data: any; timestamp: number }>()

/**
 * Clear all cached data (for testing purposes)
 * @internal
 */
export function clearCache() {
  cacheStorage.clear()
}

/**
 * Node implementation
 */
export const cacheNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  const nodeId = config._nodeId as string
  const ttl = (config.ttl ?? 300) as number // Default 5 minutes
  const invalidateTimestamp = config.invalidate as number | undefined

  console.log(`[cache] ${nodeId} - Checking cache:`, {
    nodeId,
    ttl,
    cacheStorageSize: cacheStorage.size,
    cacheStorageKeys: Array.from(cacheStorage.keys()),
    hasEntry: cacheStorage.has(nodeId)
  })

  // Check if cache should be invalidated
  const cached = cacheStorage.get(nodeId)
  if (cached && invalidateTimestamp && invalidateTimestamp > cached.timestamp) {
    console.log(`[cache] ${nodeId} - Invalidating cache (invalidateTimestamp: ${invalidateTimestamp}, cached.timestamp: ${cached.timestamp})`)
    cacheStorage.delete(nodeId)
  }

  // Check if we have valid cached data
  const now = Date.now()
  const cachedEntry = cacheStorage.get(nodeId)

  if (cachedEntry && ttl > 0) {
    const age = (now - cachedEntry.timestamp) / 1000 // Age in seconds

    if (age < ttl) {
      // Cache hit - emit badge and return cached data
      console.log(`[cache] ${nodeId} - Cache HIT (age: ${age.toFixed(1)}s, ttl: ${ttl}s)`)

      try {
        const { useMainStore } = await import('../../../store/index.js')
        const state = useMainStore.getState() as any

        if (state.addBadge) {
          state.addBadge({
            badge: {
              type: 'info' as const,
              label: 'Using cached data',
              icon: '💾',
              color: 'blue',
              variant: 'light' as const,
            },
            nodeId,
            nodeLabel: 'Cache',
            nodeKind: 'cache',
          })
        }
      } catch (e) {
        // Badge emission is optional - continue if store is not available (e.g., in tests)
      }

      return {
        context: contextIn,
        data: cachedEntry.data,
        status: 'success',
        metadata: {
          cached: true
        }
      }
    }
  }

  // Cache miss or expired - emit badge, get fresh data, and cache result
  console.log(`[cache] ${nodeId} - Cache MISS (ttl: ${ttl}s)`)

  try {
    const { useMainStore } = await import('../../../store/index.js')
    const state = useMainStore.getState() as any

    if (state.addBadge) {
      state.addBadge({
        badge: {
          type: 'info' as const,
          label: ttl === 0 ? 'Cache disabled, pulling new data...' : 'Cache expired, pulling new data...',
          icon: '🔄',
          color: 'orange',
          variant: 'light' as const,
        },
        nodeId,
        nodeLabel: 'Cache',
        nodeKind: 'cache',
      })
    }
  } catch (e) {
    // Badge emission is optional - continue if store is not available (e.g., in tests)
  }

  // Get fresh data - use dataIn if provided (push), otherwise use inputs.data (pull)
  const freshData = dataIn ?? inputs.data

  console.log(`[cache] ${nodeId} - Fresh data type:`, typeof freshData)

  // Store in cache if TTL > 0
  if (ttl > 0) {
    cacheStorage.set(nodeId, {
      data: freshData,
      timestamp: now
    })
    console.log(`[cache] ${nodeId} - Stored in cache`)
  }

  return {
    context: contextIn,
    data: freshData,
    status: 'success',
    metadata: {
      cached: false
    }
  }
}

