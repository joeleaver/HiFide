import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})


// Secure secrets API
contextBridge.exposeInMainWorld('secrets', {
  setApiKey: (k: string) => {
    return ipcRenderer.invoke('secrets:set', k)
  },
  getApiKey: async () => {
    try { return await ipcRenderer.invoke('secrets:get') } catch { return null }
  },
  setApiKeyFor: (provider: string, key: string) => {
    console.log(`[preload] setApiKeyFor(${provider}): saving via IPC, key=${key ? key.slice(0, 10) + '...' : 'empty'}`)
    return ipcRenderer.invoke('secrets:setFor', { provider, key })
  },
  getApiKeyFor: async (provider: string) => {
    try {
      const fromMain = await ipcRenderer.invoke('secrets:getFor', provider)
      console.log(`[preload] getApiKeyFor(${provider}): from main=${fromMain ? fromMain.slice(0, 10) + '...' : 'null'}`)
      return fromMain
    } catch {
      console.log(`[preload] getApiKeyFor(${provider}): main process returned null`)
      return null
    }
  },
  validateApiKeyFor: (provider: string, key: string, model?: string) => ipcRenderer.invoke('secrets:validateFor', { provider, key, model }),
  presence: () => ipcRenderer.invoke('secrets:presence'),
  onPresenceChanged: (listener: (p: { openai: boolean; anthropic: boolean; gemini: boolean }) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('secrets:presence-changed', fn)
    return () => ipcRenderer.off('secrets:presence-changed', fn)
  },

})

// Keys are now stored in electron-store in the main process - no localStorage needed!


contextBridge.exposeInMainWorld('llm', {
  cancel: (requestId: string) => ipcRenderer.invoke('llm:cancel', { requestId }),
})


// Models API: list models for a provider
contextBridge.exposeInMainWorld('models', {
  list: (provider: string) => ipcRenderer.invoke('models:list', provider),
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
contextBridge.exposeInMainWorld('capabilities', {
  get: () => ipcRenderer.invoke('capabilities:get'),
})

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
  // Agent-only: gated execution path
  execAgent: (sessionId: string, command: string, opts?: { confidence?: number; autoApproveEnabled?: boolean; autoApproveThreshold?: number }) =>
    ipcRenderer.invoke('pty:exec-agent', { sessionId, command, ...(opts || {}) }),
	  attachAgent: (opts?: { requestId?: string; sessionId?: string; tailBytes?: number }) =>
	    ipcRenderer.invoke('agent-pty:attach', opts || {}),
	  detachAgent: (sessionId: string) =>
	    ipcRenderer.invoke('agent-pty:detach', { sessionId }),

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

contextBridge.exposeInMainWorld('flowExec', {
  // V2 handlers - clean function-based execution
  run: (args: { requestId: string; flowId?: string; flowDef?: any; input?: string; model?: string; provider?: string; sessionId?: string }) =>
    ipcRenderer.invoke('flow:run:v2', args),
  resume: (requestId: string, userInput?: string) => ipcRenderer.invoke('flow:resume:v2', { requestId, userInput }),
  stop: (requestId: string) => ipcRenderer.invoke('flow:cancel:v2', { requestId }),

  // Legacy handlers (not implemented in V2 yet)
  init: (_args: { requestId: string; flowId?: string; flowDef?: any; model?: string; provider?: string; sessionId?: string }) => {
    console.warn('[flowExec.init] Not implemented in V2, use run instead')
    return Promise.resolve({ ok: false, error: 'Not implemented in V2' })
  },
  pause: (_requestId: string) => {
    console.warn('[flowExec.pause] Not implemented in V2')
    return Promise.resolve({ ok: false, error: 'Not implemented in V2' })
  },
  step: (_requestId: string) => {
    console.warn('[flowExec.step] Not implemented in V2')
    return Promise.resolve({ ok: false, error: 'Not implemented in V2' })
  },
  setBreakpoints: (_args: { requestId: string; nodeIds: string[] }) => {
    console.warn('[flowExec.setBreakpoints] Not implemented in V2')
    return Promise.resolve({ ok: false, error: 'Not implemented in V2' })
  },

  onEvent: (listener: (ev: { requestId: string; type: string; nodeId?: string; data?: any; error?: string; prompt?: string }) => void) => {
    const fn = (_: any, payload: any) => listener(payload)
    ipcRenderer.on('flow:event', fn)
    return () => ipcRenderer.off('flow:event', fn)
  },
  })


// Flow cache API
contextBridge.exposeInMainWorld('flowCache', {
  stats: () => ipcRenderer.invoke('flowCache:stats'),
  clear: () => ipcRenderer.invoke('flowCache:clear'),
})

// Models helper APIs
contextBridge.exposeInMainWorld('models', {
  cheapestClassifier: (provider: string) => ipcRenderer.invoke('models:cheapestClassifier', { provider }),
})

// Flow state persistence (Watch Mode)
contextBridge.exposeInMainWorld('flowState', {
  load: () => ipcRenderer.invoke('flowState:load'),
  save: (state: any) => ipcRenderer.invoke('flowState:save', { state }),
})


// Trace export bridge
contextBridge.exposeInMainWorld('flowTrace', {
  export: (events: any[], label?: string) => ipcRenderer.invoke('flow:trace:export', { events, label }),
})


