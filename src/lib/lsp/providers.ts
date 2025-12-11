import type * as Monaco from 'monaco-editor'
import type { CompletionItem, CompletionItemKind, Definition, Hover, Location } from 'vscode-languageserver-protocol'
import { requestCompletion, requestHover, requestDefinition } from '@/lib/lsp/client'
import { SUPPORTED_LSP_LANGUAGES, type SupportedLspLanguage } from '../../../shared/lsp'

let registered = false

function resolveRequestLanguageId(path: string, fallback: SupportedLspLanguage): SupportedLspLanguage {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx')) return 'typescriptreact'
  if (lower.endsWith('.jsx')) return 'javascriptreact'
  return fallback
}

function mapCompletionKind(monaco: typeof Monaco, kind?: CompletionItemKind | null): Monaco.languages.CompletionItemKind {
  const mk = monaco.languages.CompletionItemKind
  switch (kind) {
    case 1: return mk.Text
    case 2: return mk.Method
    case 3: return mk.Function
    case 4: return mk.Constructor
    case 5: return mk.Field
    case 6: return mk.Variable
    case 7: return mk.Class
    case 8: return mk.Interface
    case 9: return mk.Module
    case 10: return mk.Property
    case 11: return mk.Unit
    case 12: return mk.Value
    case 13: return mk.Enum
    case 14: return mk.Keyword
    case 15: return mk.Snippet
    case 16: return mk.Color
    case 17: return mk.File
    case 18: return mk.Reference
    case 19: return mk.Folder
    case 20: return mk.EnumMember
    case 21: return mk.Constant
    case 22: return mk.Struct
    case 23: return mk.Event
    case 24: return mk.Operator
    case 25: return mk.TypeParameter
    default: return mk.Text
  }
}

function toMonacoRange(monaco: typeof Monaco, range: { start: { line: number; character: number }; end: { line: number; character: number } }): Monaco.IRange {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  )
}

function toFsPath(uri: Monaco.Uri): string {
  if (uri.scheme === 'file') return uri.fsPath
  return uri.toString()
}

function normalizeCompletionItems(result: any): CompletionItem[] {
  if (!result) return []
  if (Array.isArray(result)) return result as CompletionItem[]
  if (Array.isArray(result.items)) return result.items as CompletionItem[]
  return []
}

function resolveTextEdit(
  monaco: typeof Monaco,
  item: CompletionItem,
  fallbackRange: Monaco.IRange
): { range: Monaco.IRange; insertText: string } {
  if (!item.textEdit) {
    return { range: fallbackRange, insertText: item.insertText ?? item.label }
  }
  if ('range' in item.textEdit) {
    return { range: toMonacoRange(monaco, item.textEdit.range), insertText: item.textEdit.newText }
  }
  return { range: toMonacoRange(monaco, item.textEdit.insert), insertText: item.textEdit.newText }
}

function buildCompletionSuggestions(
  monaco: typeof Monaco,
  items: CompletionItem[],
  documentRange: Monaco.IRange
): Monaco.languages.CompletionItem[] {
  return items.map((item) => {
    const { range, insertText } = resolveTextEdit(monaco, item, documentRange)
    const suggestion: Monaco.languages.CompletionItem = {
      label: item.label,
      insertText,
      kind: mapCompletionKind(monaco, item.kind ?? null),
      range,
      detail: item.detail,
      documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
      sortText: item.sortText,
      filterText: item.filterText,
    }
    if (item.insertTextFormat === 2) {
      suggestion.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
    }
    return suggestion
  })
}

function toHoverContent(monaco: typeof Monaco, hover: Hover | null): Monaco.languages.Hover | null {
  if (!hover || !hover.contents) return null
  const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
  return {
    contents: contents.map((entry) => {
      if (typeof entry === 'string') return { value: entry }
      if ('language' in entry && 'value' in entry) {
        return { value: '```' + entry.language + '\n' + entry.value + '\n```' }
      }
      if ('kind' in entry && 'value' in entry) {
        return { value: entry.value }
      }
      return { value: '' + entry }
    }),
    range: hover.range ? toMonacoRange(monaco, hover.range) : undefined,
  }
}

function toLocations(monaco: typeof Monaco, definition: Definition | null): Monaco.languages.Location[] {
  if (!definition) return []
  const locations: Location[] = Array.isArray(definition) ? definition : [definition as Location]
  return locations.map((loc) => ({
    uri: monaco.Uri.parse(loc.uri ?? ''),
    range: toMonacoRange(monaco, loc.range),
  }))
}

export function registerLspProviders(monaco: typeof Monaco): void {
  if (registered) return
  registered = true

  const triggerCharacters = ['.', '"', '\'', '/', '@', '<', '#', ' ']

  for (const languageId of SUPPORTED_LSP_LANGUAGES) {
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters,
      provideCompletionItems: async (model, position, context) => {
        const path = toFsPath(model.uri)
        const requestLanguageId = resolveRequestLanguageId(path, languageId as SupportedLspLanguage)
        const suggestionsResult = await requestCompletion({
          path,
          languageId: requestLanguageId,
          position: { line: position.lineNumber - 1, character: position.column - 1 },
          context: { triggerCharacter: context.triggerCharacter ?? undefined, triggerKind: context.triggerKind },
        })
        const rawItems = suggestionsResult?.items
        const items = normalizeCompletionItems(rawItems)
        const isIncomplete = Array.isArray(rawItems) ? false : !!rawItems?.isIncomplete
        const range = new monaco.Range(position.lineNumber, Math.max(1, position.column - 1), position.lineNumber, position.column)
        return {
          suggestions: buildCompletionSuggestions(monaco, items, range),
          incomplete: isIncomplete,
        }
      },
    })

    monaco.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position) => {
        const hover = await requestHover({
          path: toFsPath(model.uri),
          languageId: resolveRequestLanguageId(toFsPath(model.uri), languageId as SupportedLspLanguage),
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        })
        return toHoverContent(monaco, hover)
      },
    })

    monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition: async (model, position) => {
        const definition = await requestDefinition({
          path: toFsPath(model.uri),
          languageId: resolveRequestLanguageId(toFsPath(model.uri), languageId as SupportedLspLanguage),
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        })
        return toLocations(monaco, definition)
      },
    })
  }
}
