/**
 * Portal Input node
 *
 * Stores context and data in the portal registry for retrieval by matching Portal Output nodes.
 * Acts as a transparent pass-through - execution flows through as if directly connected.
 *
 * Inputs:
 * - context: Execution context (optional)
 * - data: Data value (optional)
 *
 * Outputs:
 * - context: Passes through the input context unchanged
 * - data: Passes through the input data unchanged
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
export const portalInputNode: NodeFunction = async (contextIn, dataIn, _inputs, config) => {
  const portalId = config.id as string | undefined

  if (!portalId) {
    return {
      context: contextIn,
      data: dataIn,
      status: 'error',
      error: 'Portal Input node requires an ID configuration'
    }
  }

  // Store data in portal registry (via store action)
  // Only store values that are actually present
  const hasContext = contextIn !== undefined && contextIn !== null
  const hasData = dataIn !== undefined && dataIn !== null

  if (!hasContext && !hasData) {
    return {
      context: contextIn,
      data: dataIn,
      status: 'error',
      error: 'Portal Input node requires at least one input (context or data)'
    }
  }

  const { useMainStore } = await import('../../../store/index.js')
  useMainStore.getState().feSetPortalData(
    portalId,
    hasContext ? contextIn : undefined,
    hasData ? dataIn : undefined
  )

  // Pass through inputs unchanged (transparent)
  return {
    context: contextIn,
    data: dataIn,
    status: 'success'
  }
}

