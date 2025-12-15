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

const MCP_TOOL_PREFIX = 'mcp_'

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
  const isPluginEnabled = createMcpPluginEnabledChecker(config || {})

  // Get all available tools from FlowAPI
  const allTools = flow.tools.list()

  let selectedTools: any[] = []

  if (toolsConfig === 'auto') {
    // Auto mode - provide all tools
    selectedTools = allTools
    flow.log.debug('Providing all tools', { count: allTools.length })
  } else if (Array.isArray(toolsConfig)) {
    // Specific tools mode - filter by name (support legacy colon names like "kanban:getBoard")
    const requested = toolsConfig.map((n: string) => {
      if (typeof n === 'string' && n.includes(':')) {
        const [pre, suf] = n.split(':')
        return pre + (suf ? suf.charAt(0).toUpperCase() + suf.slice(1) : '')
      }
      return n
    })
    selectedTools = allTools.filter((t: any) => requested.includes(t.name))
    flow.log.debug('Providing specific tools', {
      requested,
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
        const requested = inputTools.map((n: string) => {
          if (typeof n === 'string' && n.includes(':')) {
            const [pre, suf] = n.split(':')
            return pre + (suf ? suf.charAt(0).toUpperCase() + suf.slice(1) : '')
          }
          return n
        })
        selectedTools = allTools.filter((t: any) => requested.includes(t.name))
        flow.log.debug('Dynamic tool selection from input', {
          requested,
          found: selectedTools.length
        })
      }
    } catch {
      // Not JSON, ignore
    }
  }

  const outputTools = mergeTools(selectedTools, allTools, { isPluginEnabled })

  return {
    context: executionContext,
    tools: outputTools, // Array of tool objects for chat nodes
    status: 'success'
  }
}

function mergeTools(
  selectedTools: any[],
  allTools: any[],
  options?: { isPluginEnabled?: (pluginId?: string | null) => boolean }
): any[] {
  const pluginEnabled = options?.isPluginEnabled || (() => true)
  const seen = new Set<string>()
  const result: any[] = []

  const addTool = (tool: any) => {
    if (!tool) return
    const name = typeof tool?.name === 'string' ? tool.name : undefined
    if (name) {
      const pluginId = getMcpPluginId(name)
      if (pluginId && !pluginEnabled(pluginId)) {
        return
      }
    }
    if (!name) {
      result.push(tool)
      return
    }
    if (seen.has(name)) return
    seen.add(name)
    result.push(tool)
  }

  if (Array.isArray(selectedTools)) {
    selectedTools.forEach(addTool)
  }

  if (Array.isArray(allTools)) {
    for (const tool of allTools) {
      const name = typeof tool?.name === 'string' ? tool.name : undefined
      const pluginId = getMcpPluginId(name)
      if (!pluginId) continue
      if (!pluginEnabled(pluginId)) continue
      addTool(tool)
    }
  }

  return result
}

function createMcpPluginEnabledChecker(config: Record<string, any>): (pluginId?: string | null) => boolean {
  const legacyEnabled = config?.mcpEnabled !== false
  const overrides = isRecord(config?.mcpPlugins) ? (config.mcpPlugins as Record<string, any>) : undefined
  return (pluginId?: string | null) => {
    if (!pluginId) return true
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, pluginId)) {
      return overrides[pluginId] !== false
    }
    return legacyEnabled
  }
}

function getMcpPluginId(toolName?: string | null): string | null {
  if (typeof toolName !== 'string') return null
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return null
  const remainder = toolName.slice(MCP_TOOL_PREFIX.length)
  const separatorIndex = remainder.indexOf('_')
  if (separatorIndex === -1) return null
  const pluginId = remainder.slice(0, separatorIndex)
  return pluginId || null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

