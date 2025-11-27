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

// Back-compat for older unit tests: cache now lives in session store.
// This is a no-op exported function so tests can import and call it safely.
export const clearCache = () => {}


/**
 * Node implementation
 */
export const cacheNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected (cache is context-agnostic, just passes through)
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  const ttl = (config.ttl ?? 300) as number // Default 5 minutes
  const invalidateTimestamp = config.invalidate as number | undefined

  flow.log.debug('Checking cache', { ttl })

  // Get cached entry from session flowCache (ONLY source of truth)
  let cachedEntry = flow.store.getNodeCache(flow.nodeId)

  // Check if cache should be invalidated
  if (cachedEntry && invalidateTimestamp && invalidateTimestamp > cachedEntry.timestamp) {
    flow.log.debug('Invalidating cache', {
      invalidateTimestamp,
      cachedTimestamp: cachedEntry.timestamp
    })
    await flow.store.clearNodeCache(flow.nodeId)
    cachedEntry = undefined
  }

  // Check if we have valid cached data
  if (cachedEntry && ttl > 0) {
    const now = Date.now()
    const age = (now - cachedEntry.timestamp) / 1000 // Age in seconds

    if (age < ttl) {
      // Cache HIT - return cached data WITHOUT pulling from input
      flow.log.debug('Cache HIT', {
        age: age.toFixed(1),
        ttl
      })

      flow.conversation.addBadge({
        type: 'info',
        label: 'Using cached data',
        icon: '💾',
        color: 'blue',
        variant: 'light',
      })

      // IMPORTANT: Return cached data WITHOUT calling inputs.pull()
      // This is the key to lazy evaluation - we avoid upstream execution
      return {
        context: executionContext,
        data: cachedEntry.data,
        status: 'success',
        metadata: {
          cached: true
        }
      }
    }
  }

  // Cache MISS or expired - pull fresh data
  flow.log.debug('Cache MISS', { ttl })

  flow.conversation.addBadge({
    type: 'info',
    label: ttl === 0 ? 'Cache disabled, pulling new data...' : 'Cache expired, pulling new data...',
    icon: '🔄',
    color: 'orange',
    variant: 'light',
  })

  // Get fresh data - use dataIn if provided (push), otherwise pull from input
  // NOTE: Calling inputs.pull() triggers upstream execution (lazy evaluation)
  const freshData = dataIn ?? await inputs.pull('data')

  flow.log.debug('Fresh data received', { type: typeof freshData })

  // Store in cache if TTL > 0
  if (ttl > 0) {
    const now = Date.now()
    const cacheEntry = {
      data: freshData,
      timestamp: now
    }

    // Persist to session flowCache (ONLY storage location)
    await flow.store.setNodeCache(flow.nodeId, cacheEntry)

    flow.log.debug('Stored in cache')
  }

  return {
    context: executionContext,
    data: freshData,
    status: 'success',
    metadata: {
      cached: false
    }
  }
}

