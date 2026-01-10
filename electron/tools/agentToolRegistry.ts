import path from 'node:path'
import type { AgentTool } from '../providers/provider'
import { agentTools as builtinAgentTools } from './index.js'
import { getMcpService } from '../services/index.js'

const GLOBAL_WORKSPACE_KEY = '__global__'

const workspaceToolCache = new Map<string, AgentTool[]>()
let initialized = false

const normalizeWorkspaceId = (workspaceId?: string | null): string | null => {
  if (!workspaceId) return null
  try {
    return path.resolve(String(workspaceId))
  } catch {
    return String(workspaceId)
  }
}

const workspaceKey = (workspaceId?: string | null): string => {
  return normalizeWorkspaceId(workspaceId) ?? GLOBAL_WORKSPACE_KEY
}

const setWorkspaceTools = (workspaceId: string | null, tools: AgentTool[]): void => {
  const key = workspaceKey(workspaceId)
  workspaceToolCache.set(key, tools)
  ;(globalThis as any).__agentToolsByWorkspace = Object.fromEntries(workspaceToolCache)
  if (workspaceId === null) {
    ;(globalThis as any).__agentTools = tools
  }
}

const getCachedTools = (workspaceId?: string | null): AgentTool[] | undefined => {
  return workspaceToolCache.get(workspaceKey(workspaceId))
}

const rebuildWorkspaceTools = (workspaceId: string | null, service: ReturnType<typeof getMcpService>): void => {
  try {
    const mcpTools = service.getAgentTools({ workspaceId })
    setWorkspaceTools(workspaceId, [...builtinAgentTools, ...mcpTools])
  } catch (error) {
    console.error('[agent-tools] Failed to rebuild registry from MCP tools', error)
    setWorkspaceTools(workspaceId, [...builtinAgentTools])
  }
}

export function initializeAgentToolRegistry(): void {
  if (initialized) return
  initialized = true

  let mcpService: ReturnType<typeof getMcpService>
  try {
    mcpService = getMcpService()
  } catch (error) {
    console.error('[agent-tools] MCP service unavailable during registry init', error)
    setWorkspaceTools(null, [...builtinAgentTools])
    return
  }

  // Prime global cache with built-in tools
  setWorkspaceTools(null, [...builtinAgentTools])

  const handleChange = (payload: any) => {
    const workspaceId = (payload?.workspaceId ?? null) as string | null
    rebuildWorkspaceTools(workspaceId, mcpService)
  }

  rebuildWorkspaceTools(null, mcpService)
  mcpService.on('mcp:tools:changed', handleChange)
}

export function getAgentToolSnapshot(workspaceId?: string | null): AgentTool[] {
  const cached = getCachedTools(workspaceId)
  if (cached) {
    return cached
  }

  try {
    const service = getMcpService()
    rebuildWorkspaceTools(workspaceId ?? null, service)
    const refreshed = getCachedTools(workspaceId)
    if (refreshed) {
      return refreshed
    }
  } catch (error) {
    console.error('[agent-tools] Failed to refresh workspace tool cache', error)
  }

  return getCachedTools(null) ?? [...builtinAgentTools]
}

/**
 * Get a specific tool by name for a workspace.
 * Used by semanticTools node for tool execution.
 */
export function getToolByName(toolName: string, workspaceId?: string | null): AgentTool | undefined {
  const tools = getAgentToolSnapshot(workspaceId)
  return tools.find(t => t.name === toolName)
}
