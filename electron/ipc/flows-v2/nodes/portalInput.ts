/**
 * Portal Input node
 *
 * Stores context and data in the portal registry, then triggers all matching Portal Output nodes.
 * This enables non-linear flows (loops, callbacks) without visual edge clutter.
 *
 * Execution flow:
 * 1. Receives context/data from predecessors
 * 2. Stores in portal registry by ID
 * 3. Triggers all Portal Output nodes with matching ID (push-based notification)
 * 4. Portal Output nodes retrieve the data and continue their flows
 *
 * Inputs:
 * - context: Execution context (optional)
 * - data: Data value (optional)
 *
 * Outputs:
 * - None (Portal Input has no outgoing edges - it triggers Portal Outputs directly)
 *   Note: Returns context in result for type compliance only; scheduler ignores portal nodes for store sync.
 *
 * Config:
 * - id: Portal identifier (string) - must be unique among Portal Input nodes
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Portal input - stores data for retrieval by matching portal output nodes'
}

/**
 * Node implementation
 */
export const portalInputNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  const portalId = config.id as string | undefined

  if (!portalId) {
    flow.log.error('Portal Input node requires an ID configuration')
    return {
      context: executionContext!,
      status: 'error',
      error: 'Portal Input node requires an ID configuration'
    }
  }

  // Store data in portal registry (via store action)
  // Only store values that are actually present
  const hasContext = executionContext !== undefined && executionContext !== null
  const hasData = dataIn !== undefined && dataIn !== null

  if (!hasContext && !hasData) {
    flow.log.error('Portal Input node requires at least one input')
    return {
      context: executionContext!,
      status: 'error',
      error: 'Portal Input node requires at least one input (context or data)'
    }
  }

  flow.log.debug('Storing portal data', { portalId, hasContext, hasData })

  // Store data in portal registry
  flow.store.feSetPortalData(
    portalId,
    hasContext ? executionContext : undefined,
    hasData ? dataIn : undefined
  )

  // Trigger all Portal Output nodes with matching ID
  // This executes all Portal Output nodes that have the same portal ID
  await flow.triggerPortalOutputs(portalId)

  flow.log.debug('Portal outputs triggered', { portalId })

  // Portal Input has no outputs - it triggers Portal Outputs directly
  // Return success to indicate completion
  return {
    context: executionContext!,
    status: 'success' as const
  }
}

