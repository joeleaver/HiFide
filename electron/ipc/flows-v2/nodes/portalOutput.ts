/**
 * Portal Output node
 *
 * Retrieves context and data from the portal registry (stored by matching Portal Input node).
 * Acts as a transparent pass-through - execution flows through as if directly connected.
 *
 * For loop/iterative flows:
 * - First iteration: No portal data exists yet → passes through input context/data
 * - Subsequent iterations: Portal data available → uses portal context/data
 *
 * Inputs:
 * - context: Execution context (optional, used as fallback if no portal data)
 * - data: Data value (optional, used as fallback if no portal data)
 *
 * Outputs:
 * - context: Context retrieved from matching Portal Input (or input context if no portal data)
 * - data: Data retrieved from matching Portal Input (or input data if no portal data)
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
  pullOnly: true, // Don't auto-execute at flow start, only execute when triggered by Portal Input
  description: 'Portal output - retrieves data from matching portal input node'
}

/**
 * Node implementation
 */
export const portalOutputNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected (portal may override this)
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  const portalId = config.id as string | undefined

  if (!portalId) {
    flow.log.error('Portal Output node requires an ID configuration')
    return {
      context: executionContext,
      status: 'error',
      error: 'Portal Output node requires an ID configuration'
    }
  }

  // Retrieve data from portal registry (via store action)
  const portalData = flow.store.feGetPortalData(portalId)

  if (!portalData) {
    // No portal data yet (first iteration in a loop, or Portal Input hasn't executed)
    // Pass through the input context/data to allow flow to continue
    flow.log.debug('No portal data yet, passing through inputs', { portalId })

    // Pull data from input if edge is connected
    const inputData = inputs.has('data') ? await inputs.pull('data') : undefined

    return {
      context: executionContext,
      data: inputData,
      status: 'success'
    }
  }

  flow.log.debug('Retrieved portal data', {
    portalId,
    hasContext: !!portalData.context,
    hasData: !!portalData.data
  })

  // Return the data from the portal
  // Use portal's context if available, otherwise fall back to executionContext
  const outputContext = portalData.context || executionContext

  return {
    context: outputContext,
    data: portalData.data,
    status: 'success'
  }
}

