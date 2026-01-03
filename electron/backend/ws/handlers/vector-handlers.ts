/**
 * Vector Search and Indexing RPC handlers
 */

import { vectorHandlers, indexerHandlers } from '../service-handlers.js'

export function createVectorHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void
) {
  addMethod('vector.getState', async () => {
    return vectorHandlers.getState()
  })

  addMethod('vector.search', async (params: { query: string; options?: any }) => {
    return vectorHandlers.search(params.query, params.options)
  })

  addMethod('codeIndexer.indexWorkspace', async (params: { force?: boolean }) => {
    return (indexerHandlers as any).indexWorkspace(null, params)
  })

  addMethod('kbIndexer.indexWorkspace', async (params: { force?: boolean }) => {
    return (indexerHandlers as any).indexWorkspace(null, params)
  })
}
