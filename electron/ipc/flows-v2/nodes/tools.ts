/**
 * tools node
 *
 * Provides a list of tools to chat nodes.
 * Can be configured to provide all tools or a specific subset.
 *
 * IMPORTANT: This is a PULL-ONLY node. It does not push to successors.
 * Chat nodes pull tools from this node when they need them.
 *
 * Inputs:
 * - context: Execution context (pass-through)
 * - data: Optional dynamic tool selection override
 *
 * Outputs:
 * - context: Pass-through context
 * - tools: Array of tool objects for chat nodes (PULL-ONLY)
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // No inputs needed
  description: 'Provides a list of tools to chat nodes. Can be configured to provide all tools or a specific subset.'
}

/**
 * Node implementation
 */
export const toolsNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected (tools node is context-agnostic, just passes through)
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  const toolsConfig = config.tools || 'auto'

  // Get all available tools from FlowAPI
  const allTools = flow.tools.list()

  let selectedTools: any[] = []

  if (toolsConfig === 'auto') {
    // Auto mode - provide all tools
    selectedTools = allTools
    flow.log.debug('Providing all tools', { count: allTools.length })
  } else if (Array.isArray(toolsConfig)) {
    // Specific tools mode - filter by name
    selectedTools = allTools.filter((t: any) => toolsConfig.includes(t.name))
    flow.log.debug('Providing specific tools', {
      requested: toolsConfig,
      found: selectedTools.length
    })
  }

  // Get dynamic tool selection - use dataIn if provided (push), otherwise pull from input
  const dynamicInput = dataIn ?? (inputs.has('data') ? await inputs.pull('data') : null)

  // Check if dynamic input overrides config
  if (dynamicInput && typeof dynamicInput === 'string') {
    try {
      const inputTools = JSON.parse(dynamicInput)
      if (Array.isArray(inputTools)) {
        selectedTools = allTools.filter((t: any) => inputTools.includes(t.name))
        flow.log.debug('Dynamic tool selection from input', {
          requested: inputTools,
          found: selectedTools.length
        })
      }
    } catch {
      // Not JSON, ignore
    }
  }

  return {
    context: executionContext,
    tools: selectedTools, // Array of tool objects for chat nodes
    status: 'success'
  }
}

