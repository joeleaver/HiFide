import type { CreateMcpServerInput, UpdateMcpServerInput } from '../../../../shared/mcp.js'
import { getMcpService } from '../../../services/index.js'

import type { RpcConnection } from '../types'

export function createMcpHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  _connection: RpcConnection
): void {
  const mcpService = getMcpService()


  addMethod('mcp.listServers', async () => {
    try {
      return { ok: true, servers: mcpService.listServers() }
    } catch (error) {
      console.error('[mcp.handlers] listServers failed', error)
      return { ok: true, servers: [] }
    }
  })

  addMethod('mcp.createServer', async (params: any) => {
    const server = validateServerInput(params?.server)
    const created = await mcpService.createServer(server)
    return { ok: true, server: created }
  })

  addMethod('mcp.updateServer', async (params: any) => {
    const serverId = requireId(params?.id)
    const patch = validateUpdateInput(params?.patch)
    const updated = await mcpService.updateServer(serverId, patch)
    return { ok: true, server: updated }
  })

  addMethod('mcp.deleteServer', async (params: any) => {
    const serverId = requireId(params?.id)
    const ok = await mcpService.deleteServer(serverId)
    return { ok }
  })

  addMethod('mcp.toggleServer', async (params: any) => {
    const serverId = requireId(params?.id)
    if (typeof params?.enabled !== 'boolean') {
      throw new Error('Missing required parameter: enabled')
    }
    const server = await mcpService.toggleServer(serverId, params.enabled)
    return { ok: true, server }
  })

  addMethod('mcp.refreshServer', async (params: any) => {
    const serverId = requireId(params?.id)
    const server = await mcpService.refreshServer(serverId)
    return { ok: true, server }
  })

  addMethod('mcp.testServer', async (params: any) => {
    if (!params?.server && !params?.serverId) {
      throw new Error('Missing required parameter: server or serverId')
    }
    const result = await mcpService.testServer({ server: params.server, serverId: params.serverId })
    return result
  })
}

function requireId(value: any): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Missing required parameter: id')
  }
  return value
}

function validateServerInput(input: any): CreateMcpServerInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Missing required parameter: server')
  }
  if (!input.label) {
    throw new Error('Missing required parameter: server.label')
  }
  if (!input.transport) {
    throw new Error('Missing required parameter: server.transport')
  }
  return input as CreateMcpServerInput
}

function validateUpdateInput(input: any): UpdateMcpServerInput {
  if (!input || typeof input !== 'object') {
    return {}
  }
  return input as UpdateMcpServerInput
}
