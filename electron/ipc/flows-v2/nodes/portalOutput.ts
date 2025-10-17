/**
 * Portal Output node
 *
 * Retrieves context and data from the portal registry (stored by matching Portal Input node).
 * Acts as a transparent pass-through - execution flows through as if directly connected.
 *
 * Inputs:
 * - None (pulls data from portal registry)
 *
 * Outputs:
 * - context: Context retrieved from matching Portal Input (if available)
 * - data: Data retrieved from matching Portal Input (if available)
 *
 * Config:
 * - id: Portal identifier (string) - must match a Portal Input node's ID
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Portal output - retrieves data from matching portal input node'
}

/**
 * Node implementation
 */
export const portalOutputNode: NodeFunction = async (contextIn, _dataIn, _inputs, config) => {
  const portalId = config.id as string | undefined

  if (!portalId) {
    return {
      context: contextIn,
      status: 'error',
      error: 'Portal Output node requires an ID configuration'
    }
  }

  // Retrieve data from portal registry (via store action)
  const { useMainStore } = await import('../../../store/index.js')
  const portalData = useMainStore.getState().feGetPortalData(portalId)

  if (!portalData) {
    return {
      context: contextIn,
      status: 'error',
      error: `No Portal Input found with ID: ${portalId}`
    }
  }

  // Return the data from the portal
  // Use portal's context if available, otherwise fall back to contextIn
  const outputContext = portalData.context || contextIn

  return {
    context: outputContext,
    data: portalData.data,
    status: 'success'
  }
}

