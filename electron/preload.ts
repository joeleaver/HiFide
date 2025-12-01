import { ipcRenderer, contextBridge } from 'electron'
import { EventEmitter as NodeEventEmitter } from 'events'

// Raise listener limits to avoid noisy MaxListeners warnings during bursts of dispatches
try { NodeEventEmitter.defaultMaxListeners = 50 } catch {}
try { (ipcRenderer as any)?.setMaxListeners?.(50) } catch {}




// WebSocket backend bootstrap removed - renderer reads query params directly via location.search
// No preload bridge needed for standard browser APIs!

// Legacy secrets and models APIs removed - now managed via Zustand store
// - API keys: use settingsApiKeys in settings slice
// - Model listing: use refreshModels() action in provider slice
// - Validation: use validateApiKeys() action in settings slice


// Typed Menu API with off() support and listener tracking
const __menuListenerMap: Map<string, Map<Function, Function>> = new Map()
contextBridge.exposeInMainWorld('menu', {
  popup: (args: { menu: string; x: number; y: number }) => ipcRenderer.invoke('menu:popup', args),
  on: (name: string, listener: (payload?: any) => void) => {
    const channel = `menu:${name}`
    const fn = (_: any, payload: any) => listener(payload)
    let byName = __menuListenerMap.get(channel)
    if (!byName) { byName = new Map(); __menuListenerMap.set(channel, byName) }
    byName.set(listener, fn)
    ipcRenderer.on(channel, fn)
    return () => {
      ipcRenderer.off(channel, fn)
      byName?.delete(listener)
    }
  },
  off: (name: string, listener: (payload?: any) => void) => {
    const channel = `menu:${name}`
    const byName = __menuListenerMap.get(channel)
    const fn = byName?.get(listener)
    if (fn) {
      ipcRenderer.off(channel, fn as any)
      byName?.delete(listener)
    } else {
      // Fallback: attempt to remove the original listener (may no-op if wrapper was used)
      try { ipcRenderer.off(channel, listener as any) } catch {}
    }
  },
})


// App API removed - view changes handled via WebSocket RPC (view.set)
// The old IPC handler was calling a no-op stub in main process

// Removed unused APIs (now handled via WebSocket JSON-RPC):
// - window.fs (getCwd, readFile, readDir, watchDir, unwatch, onWatch)
// - window.sessions (list, load, save, delete)
// - window.capabilities (get)
// - window.agent (onMetrics)

// Removed unused TypeScript refactoring APIs (never used in renderer):
// - window.tsRefactor (rename, organizeImports)
// - window.tsRefactorEx (addExportNamed, moveFile)
// - window.tsExportUtils (ensureDefaultExport, addExportFrom)
// - window.tsTransform (suggestParams, extractFunction)
// - window.tsInline (inlineVariable, inlineFunction, defaultToNamed, namedToDefault)
// Implementations remain in electron/refactors/ts.ts and electron/ipc/refactoring.ts
// for potential future use or LLM tool integration



// Removed unused APIs (now handled via WebSocket JSON-RPC):
// - window.edits (apply, propose)
// - window.indexing (rebuild, cancel, status, clear, search, onProgress)


// Workspace API removed - all workspace operations now handled via WebSocket RPC:
// - workspace.openFolderDialog - Open native folder picker dialog
// - workspace.open - Open workspace folder
// - workspace.get - Get current workspace info
// - workspace.listRecentFolders - List recent folders
// - settings.get - Get workspace settings
// - settings.* - Various setting operations

// Removed unused APIs (now handled via WebSocket JSON-RPC):
// - window.flowProfiles (get, set, list, delete, has)
// - window.ratelimits (get, set)




