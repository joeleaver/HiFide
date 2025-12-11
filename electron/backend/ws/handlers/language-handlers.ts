import type { RpcConnection } from '../types'
import { getConnectionWorkspaceId } from '../broadcast.js'
import { getLanguageServerService } from '../../../services/index.js'
import type {
  LspDocumentParams,
  LspCompletionRequest,
  LspHoverRequest,
  LspDefinitionRequest,
  LspProvisionLanguageRequest,
} from '../../../../shared/lsp.js'

export function createLanguageHandlers(
  addMethod: (method: string, handler: (params: any) => any) => void,
  connection: RpcConnection
) {
  const languageService = getLanguageServerService()

  const ensureWorkspace = async (): Promise<string> => {
    const workspaceRoot = await getConnectionWorkspaceId(connection)
    if (!workspaceRoot) {
      throw Object.assign(new Error('no-workspace'), { code: 'no-workspace' })
    }
    return workspaceRoot
  }

  addMethod('lsp.openDocument', async (input: LspDocumentParams) => {
    try {
      if (!input?.path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await ensureWorkspace()
      await languageService.openDocument(workspaceRoot, input)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'open-failed' }
    }
  })

  addMethod('lsp.changeDocument', async (input: LspDocumentParams) => {
    try {
      if (!input?.path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await ensureWorkspace()
      await languageService.changeDocument(workspaceRoot, input)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'change-failed' }
    }
  })

  addMethod('lsp.closeDocument', async ({ path }: { path: string }) => {
    try {
      if (!path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await ensureWorkspace()
      await languageService.closeDocument(workspaceRoot, path)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'close-failed' }
    }
  })

  addMethod('lsp.completion', async (input: LspCompletionRequest) => {
    try {
      if (!input?.path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await ensureWorkspace()
      const result = await languageService.requestCompletion(workspaceRoot, input)
      return { ok: true, result }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'completion-failed' }
    }
  })

  addMethod('lsp.hover', async (input: LspHoverRequest) => {
    try {
      if (!input?.path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await ensureWorkspace()
      const hover = await languageService.requestHover(workspaceRoot, input)
      return { ok: true, hover }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'hover-failed' }
    }
  })

  addMethod('lsp.definition', async (input: LspDefinitionRequest) => {
    try {
      if (!input?.path) return { ok: false, error: 'path-required' }
      const workspaceRoot = await ensureWorkspace()
      const definition = await languageService.requestDefinition(workspaceRoot, input)
      return { ok: true, definition }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'definition-failed' }
    }
  })

  addMethod('lsp.languages', async () => {
    try {
      const snapshot = await languageService.listLanguageStatuses()
      return { ok: true, languages: snapshot.languages, autoInstall: snapshot.autoInstall }
    } catch (error: any) {
      return { ok: false, error: error?.message || 'languages-failed' }
    }
  })

  addMethod('lsp.provisionLanguage', async (input: LspProvisionLanguageRequest) => {
    try {
      if (!input?.languageId) return { ok: false, error: 'language-required' }
      const status = await languageService.provisionLanguage(input.languageId)
      return { ok: true, status }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'provision-failed' }
    }
  })

  addMethod('lsp.setAutoInstall', async ({ enabled }: { enabled: boolean }) => {
    try {
      languageService.setAutoInstall(!!enabled)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message || 'auto-install-failed' }
    }
  })

  addMethod('lsp.resetWorkspace', async () => {
    try {
      const workspaceRoot = await ensureWorkspace()
      await languageService.resetWorkspace(workspaceRoot)
      await languageService.prepareWorkspace(workspaceRoot)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.code || error?.message || 'reset-failed' }
    }
  })
}
