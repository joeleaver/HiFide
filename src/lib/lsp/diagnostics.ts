import type * as Monaco from 'monaco-editor'
import { URI } from 'vscode-uri'
import type { LspDiagnosticsEvent } from '../../../shared/lsp'
import { getMonacoInstance, withMonaco } from '@/lib/editor/monacoInstance'

const MARKER_OWNER = 'lsp'
const pendingByUri = new Map<string, LspDiagnosticsEvent>()

function toMarkerSeverity(monaco: typeof Monaco, severity?: number): Monaco.MarkerSeverity {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error
    case 2: return monaco.MarkerSeverity.Warning
    case 3: return monaco.MarkerSeverity.Info
    case 4: return monaco.MarkerSeverity.Hint
    default: return monaco.MarkerSeverity.Info
  }
}

function toUri(uri: string, fallbackPath?: string): string {
  if (uri?.startsWith('file:')) return uri
  if (fallbackPath) {
    try {
      return URI.file(fallbackPath).toString()
    } catch {
      return uri
    }
  }
  return uri
}

function flushDiagnostics(uri: string): void {
  const monaco = getMonacoInstance()
  if (!monaco) return
  const payload = pendingByUri.get(uri)
  if (!payload) return

  const targetUri = monaco.Uri.parse(uri)
  const model = monaco.editor.getModel(targetUri)
  if (!model) return

  const markers: Monaco.editor.IMarkerData[] = payload.diagnostics.map((diag) => ({
    message: diag.message,
    severity: toMarkerSeverity(monaco, diag.severity),
    startLineNumber: diag.startLine + 1,
    startColumn: diag.startCharacter + 1,
    endLineNumber: diag.endLine + 1,
    endColumn: diag.endCharacter + 1,
    source: diag.source,
    code: typeof diag.code === 'number' ? String(diag.code) : diag.code,
  }))

  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers)
}

export function handleDiagnostics(payload: LspDiagnosticsEvent): void {
  const uri = toUri(payload.uri, payload.path)
  pendingByUri.set(uri, { ...payload, uri })
  flushDiagnostics(uri)
}

export function clearDiagnosticsForWorkspace(workspaceRoot?: string | null): void {
  if (!workspaceRoot) {
    pendingByUri.clear()
    return
  }
  for (const [uri, payload] of Array.from(pendingByUri.entries())) {
    if (payload.workspaceRoot === workspaceRoot) {
      pendingByUri.delete(uri)
    }
  }
}

withMonaco(() => {
  for (const uri of pendingByUri.keys()) {
    flushDiagnostics(uri)
  }
})
