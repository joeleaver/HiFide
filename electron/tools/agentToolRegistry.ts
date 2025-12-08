import type { AgentTool } from '../providers/provider'
import { agentTools as builtinAgentTools } from './index.js'
import { getMcpService } from '../services/index.js'

let initialized = false
let cachedTools: AgentTool[] = [...builtinAgentTools]

function setGlobalTools(next: AgentTool[]): void {
  cachedTools = next
  ;(globalThis as any).__agentTools = next
}

// Ensure built-in tools are available immediately
if (!(globalThis as any).__agentTools) {
  setGlobalTools([...builtinAgentTools])
}

export function initializeAgentToolRegistry(): void {
  if (initialized) return
  initialized = true

  let mcpService: ReturnType<typeof getMcpService>
  try {
    mcpService = getMcpService()
  } catch (error) {
    console.error('[agent-tools] MCP service unavailable during registry init', error)
    setGlobalTools([...builtinAgentTools])
    return
  }

  const rebuild = () => {
    try {
      const mcpTools = mcpService.getAgentTools()
      setGlobalTools([...builtinAgentTools, ...mcpTools])
    } catch (error) {
      console.error('[agent-tools] Failed to rebuild registry from MCP tools', error)
      setGlobalTools([...builtinAgentTools])
    }
  }

  rebuild()
  mcpService.on('mcp:tools:changed', rebuild)
}

export function getAgentToolSnapshot(): AgentTool[] {
  const current = (globalThis as any).__agentTools
  if (Array.isArray(current)) {
    return current as AgentTool[]
  }
  return cachedTools
}
