import { 
  CompletionTriggerKind,
} from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import path from 'node:path'

export type ServerStatus = 'idle' | 'starting' | 'ready' | 'stopped' | 'error'

export function normalizePath(p: string): string {
  let resolved = path.normalize(path.resolve(p))
  if (process.platform === 'win32') {
    if (/^[a-zA-Z]:/.test(resolved)) {
      resolved = resolved[0].toLowerCase() + resolved.slice(1)
    }
  }
  return resolved
}

export function toLspUri(filePath: string): string {
  return URI.file(normalizePath(filePath)).toString()
}

export function fromLspUri(uri: string): string {
  return normalizePath(URI.parse(uri).fsPath)
}

export function normalizeTriggerKind(kind?: number): CompletionTriggerKind {
  if (kind === CompletionTriggerKind.TriggerCharacter || kind === CompletionTriggerKind.TriggerForIncompleteCompletions) {
    return kind
  }
  return CompletionTriggerKind.Invoked
}
