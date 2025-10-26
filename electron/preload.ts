import { ipcRenderer, contextBridge } from 'electron'
import { preloadBridge } from '@zubridge/electron/preload'

// --------- Set up zubridge for state synchronization ---------
const { handlers } = preloadBridge()
contextBridge.exposeInMainWorld('zubridge', handlers)



// Legacy secrets and models APIs removed - now managed via Zustand store
// - API keys: use settingsApiKeys in settings slice
// - Model listing: use refreshModels() action in provider slice
// - Validation: use validateApiKeys() action in settings slice


// Typed Menu API
contextBridge.exposeInMainWorld('menu', {
  popup: (args: { menu: string; x: number; y: number }) => ipcRenderer.invoke('menu:popup', args),
  on: (name: string, listener: (payload?: any) => void) => {
    const channel = `menu:${name}`
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.off(channel, fn)
  },
})

// Window controls API
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
})

// App API
contextBridge.exposeInMainWorld('app', {
  setView: (view: string) => ipcRenderer.invoke('app:set-view', view),
})

// File system API
contextBridge.exposeInMainWorld('fs', {
  getCwd: () => ipcRenderer.invoke('fs:getCwd'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  watchDir: (dirPath: string) => ipcRenderer.invoke('fs:watchStart', dirPath),
  unwatch: (id: number) => ipcRenderer.invoke('fs:watchStop', id),
  onWatch: (listener: (payload: { id: number; type: 'rename'|'change'; path: string; dir: string }) => void) => {
    const fn = (_: any, payload: any) => listener(payload)

    ipcRenderer.on('fs:watch:event', fn)
    return () => ipcRenderer.off('fs:watch:event', fn)
  },
})

// Session management API
contextBridge.exposeInMainWorld('sessions', {
  list: () => ipcRenderer.invoke('sessions:list'),

  load: (sessionId: string) => ipcRenderer.invoke('sessions:load', sessionId),
  save: (session: any) => ipcRenderer.invoke('sessions:save', session),
  delete: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),
})

// App capabilities API
contextBridge.exposeInMainWorld('capabilities', {
  get: () => ipcRenderer.invoke('capabilities:get'),
})


// Agent metrics API
contextBridge.exposeInMainWorld('agent', {
  onMetrics: (listener: (payload: any) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('agent:metrics', fn)
    return () => ipcRenderer.off('agent:metrics', fn)
  },
})

// PTY (embedded terminal) API
contextBridge.exposeInMainWorld('pty', {
  create: (opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean }) =>
    ipcRenderer.invoke('pty:create', opts || {}),


  write: (sessionId: string, data: string) =>
    ipcRenderer.invoke('pty:write', { sessionId, data }),
  resize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:resize', { sessionId, cols, rows }),
  dispose: (sessionId: string) =>
    ipcRenderer.invoke('pty:dispose', { sessionId }),
  // Agent-only execution path
  execAgent: (sessionId: string, command: string) =>
    ipcRenderer.invoke('pty:exec-agent', { sessionId, command }),
	  attachAgent: (opts?: { requestId?: string; sessionId?: string; tailBytes?: number }) =>
	    ipcRenderer.invoke('agent-pty:attach', opts || {}),
	  detachAgent: (sessionId: string) =>
	    ipcRenderer.invoke('agent-pty:detach', { sessionId }),
	  killAgent: (requestId: string) =>
	    ipcRenderer.invoke('agent-pty:kill', { requestId }),

  onData: (listener: (payload: { sessionId: string; data: string }) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('pty:data', fn)
    return () => ipcRenderer.off('pty:data', fn)
  },
  onExit: (listener: (payload: { sessionId: string; exitCode: number }) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('pty:exit', fn)
    return () => ipcRenderer.off('pty:exit', fn)
  },
})


// TypeScript refactor API (MVP)
contextBridge.exposeInMainWorld('tsRefactor', {
  rename: (filePath: string, oldName: string, newName: string, opts?: { verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:rename', { filePath, oldName, newName, ...(opts || {}) }),
  organizeImports: (opts?: { filePath?: string; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:organizeImports', opts || {}),
})

// Extended TS refactors
contextBridge.exposeInMainWorld('tsRefactorEx', {
  addExportNamed: (filePath: string, exportName: string, code?: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:addExportNamed', { filePath, exportName, code, ...(opts || {}) }),
  moveFile: (fromPath: string, toPath: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:moveFile', { fromPath, toPath, ...(opts || {}) }),
})
contextBridge.exposeInMainWorld('tsExportUtils', {
  ensureDefaultExport: (filePath: string, name?: string, code?: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:ensureDefaultExport', { filePath, name, code, ...(opts || {}) }),
  addExportFrom: (indexFilePath: string, exportName: string, fromFilePath: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:addExportFrom', { indexFilePath, exportName, fromFilePath, ...(opts || {}) }),
})
contextBridge.exposeInMainWorld('tsTransform', {
  suggestParams: (filePath: string, start: number, end: number, opts?: { tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:suggestParams', { filePath, start, end, ...(opts||{}) }),
  extractFunction: (filePath: string, start: number, end: number, newName: string, opts?: { params?: string[]; apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:extractFunction', { filePath, start, end, newName, ...(opts||{}) }),
})
contextBridge.exposeInMainWorld('tsInline', {
  inlineVariable: (filePath: string, name: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:inlineVariable', { filePath, name, ...(opts||{}) }),
  inlineFunction: (filePath: string, name: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:inlineFunction', { filePath, name, ...(opts||{}) }),
  defaultToNamed: (filePath: string, newName: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:defaultToNamed', { filePath, newName, ...(opts||{}) }),
  namedToDefault: (filePath: string, name: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('tsrefactor:namedToDefault', { filePath, name, ...(opts||{}) }),
})



// Generic edits API
contextBridge.exposeInMainWorld('edits', {
  apply: (edits: Array<any>, opts?: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string }) =>
    ipcRenderer.invoke('edits:apply', { edits, ...(opts||{}) }),
  propose: (instruction: string, model?: string, provider?: string, k?: number) =>
    ipcRenderer.invoke('edits:propose', { instruction, model, provider, k }),
})




contextBridge.exposeInMainWorld('indexing', {
  rebuild: () => ipcRenderer.invoke('index:rebuild'),
  cancel: () => ipcRenderer.invoke('index:cancel'),
  status: () => ipcRenderer.invoke('index:status'),
  clear: () => ipcRenderer.invoke('index:clear'),
  search: (query: string, k?: number) => ipcRenderer.invoke('index:search', { query, k }),
  onProgress: (listener: (prog: any) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('index:progress', fn)
    return () => ipcRenderer.off('index:progress', fn)
  },
})


// Workspace API
contextBridge.exposeInMainWorld('workspace', {
  getRoot: () => ipcRenderer.invoke('workspace:get-root'),
  setRoot: (newRoot: string) => ipcRenderer.invoke('workspace:set-root', newRoot),
  openFolderDialog: () => ipcRenderer.invoke('workspace:open-folder-dialog'),
  notifyRecentFoldersChanged: (recentFolders: Array<{ path: string; lastOpened: number }>) =>
    ipcRenderer.send('workspace:recent-folders-changed', recentFolders),
  bootstrap: (baseDir: string, preferAgent?: boolean, overwrite?: boolean) =>
    ipcRenderer.invoke('workspace:bootstrap', { baseDir, preferAgent, overwrite }),
  ensureDirectory: (dirPath: string) => ipcRenderer.invoke('workspace:ensure-directory', dirPath),
  getSettings: () => ipcRenderer.invoke('workspace:get-settings'),
  setSetting: (key: string, value: any) => ipcRenderer.invoke('workspace:set-setting', key, value),
  fileExists: (filePath: string) => ipcRenderer.invoke('workspace:file-exists', filePath),
  readFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('workspace:write-file', filePath, content),
  listFiles: (dirPath: string) => ipcRenderer.invoke('workspace:list-files', dirPath),
})

// Flow Profiles API
contextBridge.exposeInMainWorld('flowProfiles', {
  get: (profileName: string) => ipcRenderer.invoke('flow-profiles:get', profileName),
  set: (profileName: string, profile: any) => ipcRenderer.invoke('flow-profiles:set', profileName, profile),
  list: () => ipcRenderer.invoke('flow-profiles:list'),
  delete: (profileName: string) => ipcRenderer.invoke('flow-profiles:delete', profileName),
  has: (profileName: string) => ipcRenderer.invoke('flow-profiles:has', profileName),
})

// Rate limits API
contextBridge.exposeInMainWorld('ratelimits', {
  get: () => ipcRenderer.invoke('ratelimits:get'),
  set: (config: any) => ipcRenderer.invoke('ratelimits:set', config),
})


// Flows API (Flow definitions & execution)
contextBridge.exposeInMainWorld('flows', {
  list: () => ipcRenderer.invoke('flows:list'),
  load: (flowIdOrPath: string) => ipcRenderer.invoke('flows:load', { idOrPath: flowIdOrPath }),
  save: (flowId: string, def: any) => ipcRenderer.invoke('flows:save', { id: flowId, def }),
  getTools: () => ipcRenderer.invoke('flows:getTools'),
})
// NOTE: Flow execution is now handled via store actions (flowInit, feStop, feResume)
// No need for window.flowExec.run/stop/resume anymore - use dispatch() instead!

// Flow events are still sent via IPC for real-time updates
contextBridge.exposeInMainWorld('flowExec', {
  onEvent: (listener: (ev: { requestId: string; type: string; nodeId?: string; data?: any; error?: string; prompt?: string }) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('flow:event', fn)
    return () => ipcRenderer.off('flow:event', fn)
  },
})


