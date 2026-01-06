/**
 * Vector Search and Indexing RPC handlers
 */

import { vectorHandlers, indexerHandlers } from '../service-handlers.js'

export function createVectorHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: any
) {
  addMethod('vector.getState', async () => {
    return vectorHandlers.getState(connection)
  })

  addMethod('vector.search', async (params: { query: string; options?: any }) => {
    return vectorHandlers.search(connection, params.query, params.options)
  })

  addMethod('codeIndexer.indexWorkspace', async (params: { force?: boolean }) => {
    return (indexerHandlers as any).indexWorkspace(connection, { ...params, table: 'code' })
  })

  addMethod('kbIndexer.indexWorkspace', async (params: { force?: boolean }) => {
    return (indexerHandlers as any).indexWorkspace(connection, { ...params, table: 'kb' })
  })

  addMethod('memoriesIndexer.indexWorkspace', async (params: { force?: boolean }) => {
    return (indexerHandlers as any).indexWorkspace(connection, { ...params, table: 'memories' })
  })

  // The following methods are called by Worker Threads via JSON-RPC over the WebSocket bus.
  // The Main process (this server) acts as the bridge/coordinator.
  addMethod('discover', async (params: { workspaceRoot: string }) => {
    return (indexerHandlers as any).discover(params)
  })

  addMethod('parse', async (params: { filePath: string; workspaceRoot: string }) => {
    return (indexerHandlers as any).parse(params)
  })
}
