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
export const toolsNode: NodeFunction = async (contextIn, dataIn, _inputs, config) => {
  const toolsConfig = config.tools || 'auto'

  console.log('[tools] Config:', { toolsConfig, dataIn })

  // Get all available tools from globalThis
  const allTools = (globalThis as any).__agentTools || []
  console.log('[tools] Total available tools:', allTools.length)

  let selectedTools: any[] = []

  if (toolsConfig === 'auto') {
    // Auto mode - provide all tools
    selectedTools = allTools
    console.log('[tools] Auto mode - providing all tools')
  } else if (Array.isArray(toolsConfig)) {
    // Specific tools mode - filter by name
    selectedTools = allTools.filter((t: any) => toolsConfig.includes(t.name))
    console.log('[tools] Specific mode - config has:', toolsConfig)
    console.log('[tools] Filtered to:', selectedTools.map((t: any) => t.name))
  }

  // Check if dataIn overrides config (dynamic tool selection)
  if (dataIn && typeof dataIn === 'string') {
    try {
      const inputTools = JSON.parse(dataIn)
      if (Array.isArray(inputTools)) {
        selectedTools = allTools.filter((t: any) => inputTools.includes(t.name))
        console.log('[tools] Dynamic override from dataIn:', inputTools)
      }
    } catch {
      // Not JSON, ignore
    }
  }

  console.log('[tools] Returning', selectedTools.length, 'tools:', selectedTools.map((t: any) => t.name).join(', '))

  return {
    context: contextIn,
    tools: selectedTools, // Array of tool objects for chat nodes
    status: 'success'
  }
}

