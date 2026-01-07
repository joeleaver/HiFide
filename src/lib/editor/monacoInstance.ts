import type * as Monaco from 'monaco-editor'

type MonacoCallback = (monaco: typeof import('monaco-editor')) => void

let instance: typeof import('monaco-editor') | null = null
const pending: MonacoCallback[] = []
let configured = false

function applyLanguageDefaults(monaco: typeof Monaco): void {
  if (configured) return
  const ts = monaco.languages?.typescript
  if (!ts) return

  // Disable Monaco's built-in TypeScript validation since we use LSP for diagnostics
  // This prevents false positives and conflicts with the language server
  const diagnosticOptions = {
    noSemanticValidation: true,  // Disable semantic validation - LSP handles this
    noSyntaxValidation: false     // Keep syntax validation for immediate feedback
  }
  const sharedCompilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    resolveJsonModule: true,
  }

  ts.typescriptDefaults.setCompilerOptions(sharedCompilerOptions)
  ts.typescriptDefaults.setDiagnosticsOptions(diagnosticOptions)
  ts.typescriptDefaults.setEagerModelSync(true)

  ts.javascriptDefaults.setCompilerOptions(sharedCompilerOptions)
  ts.javascriptDefaults.setDiagnosticsOptions(diagnosticOptions)
  ts.javascriptDefaults.setEagerModelSync(true)

  configured = true
}

export function registerMonacoInstance(monaco: typeof Monaco): void {
  instance = monaco
  applyLanguageDefaults(monaco)
  while (pending.length > 0) {
    const cb = pending.shift()
    try {
      cb?.(monaco)
    } catch (error) {
      console.warn('[monacoInstance] Failed to run pending callback', error)
    }
  }
}

export function withMonaco(callback: MonacoCallback): void {
  if (instance) {
    callback(instance)
  } else {
    pending.push(callback)
  }
}

export function getMonacoInstance(): typeof Monaco | null {
  return instance
}
