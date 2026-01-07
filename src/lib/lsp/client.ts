import type { LspDocumentParams, LspCompletionRequest, LspHoverRequest, LspDefinitionRequest } from '../../../shared/lsp'
import { isLspLanguage } from '../../../shared/lsp'
import { getBackendClient } from '@/lib/backend/bootstrap'

async function callRpc<T = any>(method: string, params: unknown): Promise<T | null> {
  const client = getBackendClient()
  if (!client) return null
  try {
    return await client.rpc<T>(method, params)
  } catch (error) {
    console.warn(`[lspClient] ${method} failed`, error)
    return null
  }
}

export async function openDocument(payload: LspDocumentParams): Promise<void> {
  if (!isLspLanguage(payload.languageId)) {
    console.warn(`[lspClient] openDocument: unsupported language "${payload.languageId}" for ${payload.path}`)
    return
  }
  console.log(`[lspClient] openDocument: ${payload.path} (${payload.languageId})`)
  const res: any = await callRpc('lsp.openDocument', payload)
  if (res && res.ok === false && res.error) {
    throw Object.assign(new Error(res.error), { code: res.error, languageId: payload.languageId })
  }
}

export async function changeDocument(payload: LspDocumentParams): Promise<void> {
  if (!isLspLanguage(payload.languageId)) return
  const res: any = await callRpc('lsp.changeDocument', payload)
  if (res && res.ok === false && res.error) {
    throw Object.assign(new Error(res.error), { code: res.error, languageId: payload.languageId })
  }
}

export async function closeDocument(path: string): Promise<void> {
  if (!path) return
  await callRpc('lsp.closeDocument', { path })
}

export async function requestCompletion(payload: LspCompletionRequest): Promise<any> {
  if (!isLspLanguage(payload.languageId)) return null
  const res: any = await callRpc('lsp.completion', payload)
  return res?.result ?? null
}

export async function requestHover(payload: LspHoverRequest): Promise<any> {
  if (!isLspLanguage(payload.languageId)) return null
  const res: any = await callRpc('lsp.hover', payload)
  return res?.hover ?? null
}

export async function requestDefinition(payload: LspDefinitionRequest): Promise<any> {
  if (!isLspLanguage(payload.languageId)) return null
  const res: any = await callRpc('lsp.definition', payload)
  return res?.definition ?? null
}

export async function resetWorkspace(): Promise<void> {
  await callRpc('lsp.resetWorkspace', {})
}
