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
  setApiKey: (k: string) => ipcRenderer.invoke('secrets:set', k),
  getApiKey: () => ipcRenderer.invoke('secrets:get'),
  setApiKeyFor: (provider: string, key: string) => ipcRenderer.invoke('secrets:setFor', { provider, key }),
  getApiKeyFor: (provider: string) => ipcRenderer.invoke('secrets:getFor', provider),
  validateApiKeyFor: (provider: string, key: string, model?: string) => ipcRenderer.invoke('secrets:validateFor', { provider, key, model }),
  presence: () => ipcRenderer.invoke('secrets:presence'),
})


contextBridge.exposeInMainWorld('llm', {
  start: (requestId: string, messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>, model?: string, provider?: string) =>
    ipcRenderer.invoke('llm:start', { requestId, messages, model, provider }),
  agentStart: (
    requestId: string,
    messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>,
    model?: string,
    provider?: string,
    tools?: string[],
    responseSchema?: any,
  ) => ipcRenderer.invoke('llm:agentStart', { requestId, messages, model, provider, tools, responseSchema }),
  cancel: (requestId: string) => ipcRenderer.invoke('llm:cancel', { requestId }),
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
