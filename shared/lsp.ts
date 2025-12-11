import type { DiagnosticSeverity } from 'vscode-languageserver-protocol'

export type SupportedLspLanguage =
  | 'typescript'
  | 'javascript'
  | 'typescriptreact'
  | 'javascriptreact'
  | 'json'
  | 'python'
  | 'yaml'

export type LspLanguageStatusValue = 'disabled' | 'pending' | 'installing' | 'ready' | 'error' | 'unsupported'

export const SUPPORTED_LSP_LANGUAGES: SupportedLspLanguage[] = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'json',
  'python',
  'yaml',
]

export function isLspLanguage(languageId?: string | null): languageId is SupportedLspLanguage {
  if (!languageId) return false
  return SUPPORTED_LSP_LANGUAGES.includes(languageId as SupportedLspLanguage)
}

export interface LspDocumentParams {
  path: string
  languageId: string
  text: string
  version: number
}

export interface LspPosition {
  line: number
  character: number
}

export interface LspCompletionContext {
  triggerKind: number
  triggerCharacter?: string
}

export interface LspCompletionRequest {
  path: string
  languageId: string
  position: LspPosition
  context?: LspCompletionContext
}

export interface LspHoverRequest {
  path: string
  languageId: string
  position: LspPosition
}

export interface LspDefinitionRequest {
  path: string
  languageId: string
  position: LspPosition
}

export interface LspDiagnosticsEvent {
  workspaceRoot: string
  uri: string
  path: string
  languageId?: string
  diagnostics: Array<{
    message: string
    severity?: DiagnosticSeverity
    source?: string
    code?: string | number
    startLine: number
    startCharacter: number
    endLine: number
    endCharacter: number
  }>
  updatedAt: number
}

export interface LspSemanticTokensRequest {
  path: string
  languageId: string
}

export const LSP_NOTIFICATION_DIAGNOSTICS = 'lsp.diagnostics'
export const LSP_NOTIFICATION_LANGUAGE_STATUS = 'lsp.languageStatus'

export interface LspLanguageStatusPayload {
  languageId: string
  serverKey: string
  displayName: string
  status: LspLanguageStatusValue
  autoInstallable: boolean
  masonPackage?: string
  version?: string
  lastError?: string | null
  updatedAt: number
}

export interface LspLanguageListResponse {
  autoInstall: boolean
  languages: LspLanguageStatusPayload[]
}

export interface LspProvisionLanguageRequest {
  languageId: string
  reason: 'auto' | 'user'
}
