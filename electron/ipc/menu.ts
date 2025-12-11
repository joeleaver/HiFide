/**
 * Menu and window control IPC handlers
 */

import type { IpcMain, MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, Menu, shell, app } from 'electron'
import { getWindow, windowStateStore } from '../core/state'
import { createWindow } from '../core/window'
import type { ViewType } from '../store/types'
import type { RendererMenuStatePayload } from '../../shared/menu.js'
import { DEFAULT_RENDERER_MENU_STATE } from '../../shared/menu.js'
import { getWorkspaceService } from '../services/index.js'

function normalizeMenuState(state?: RendererMenuStatePayload): RendererMenuStatePayload {
  const base = state ?? DEFAULT_RENDERER_MENU_STATE
  return {
    view: (base.view as ViewType) ?? 'flow',
    workspaceAttached: !!base.workspaceAttached,
    hasOpenTab: !!base.hasOpenTab,
    hasDirtyTab: !!base.hasDirtyTab,
    windowId: typeof base.windowId === 'number' ? base.windowId : base.windowId ?? null,
    fileActions: {
      visible: !!base.fileActions?.visible,
      canCreateFile: !!base.fileActions?.canCreateFile,
      canOpenFile: !!base.fileActions?.canOpenFile,
      canSave: !!base.fileActions?.canSave,
      canSaveAs: !!base.fileActions?.canSaveAs,
    },
  }
}

let rendererMenuState: RendererMenuStatePayload = normalizeMenuState()
let rendererMenuStateJson = JSON.stringify(rendererMenuState)

const menuRefs: {
  file?: Electron.Menu
  edit?: Electron.Menu
  view?: Electron.Menu
  window?: Electron.Menu
  help?: Electron.Menu
} = {}

const VIEW_SHORTCUTS: Array<{ view: ViewType; label: string; accelerator: string; channel: string }> = [
  { view: 'flow', label: 'Flow', accelerator: process.platform === 'darwin' ? 'Cmd+1' : 'Ctrl+1', channel: 'menu:open-chat' },
  { view: 'flowEditor' as ViewType, label: 'Flow Editor', accelerator: process.platform === 'darwin' ? 'Cmd+2' : 'Ctrl+2', channel: 'menu:open-flow-editor' },
  { view: 'kanban', label: 'Kanban Board', accelerator: process.platform === 'darwin' ? 'Cmd+3' : 'Ctrl+3', channel: 'menu:open-kanban' },
  { view: 'settings', label: 'Settings', accelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,', channel: 'menu:open-settings' },
]

function sendMenuEvent(channel: string, ...args: any[]) {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
  wc?.send(channel, ...args)
}

export function updateRendererMenuState(next: RendererMenuStatePayload): void {
  const normalized = normalizeMenuState(next)
  const json = JSON.stringify(normalized)
  if (json === rendererMenuStateJson) return
  rendererMenuState = normalized
  rendererMenuStateJson = json
  buildMenu()
}

export function setCurrentViewForMenu(view: ViewType) {
  updateRendererMenuState({
    ...rendererMenuState,
    view,
    fileActions: { ...rendererMenuState.fileActions },
  })
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  let recentFolders: Array<{ path: string; lastOpened: number }> = []
  try {
    // Source of truth: WorkspaceService
    const workspaceService = getWorkspaceService()
    recentFolders = workspaceService.getRecentFolders() || []

    // One-time migration from legacy windowStateStore if store is empty
    if (recentFolders.length === 0) {
      const legacy = windowStateStore.get('recentFolders') as any
      if (Array.isArray(legacy) && legacy.length > 0) {
        recentFolders = legacy.slice(0, 10)
        try {
          // Migrate legacy folders to service
          for (const folder of legacy) {
            workspaceService.addRecentFolder(folder)
          }
        } catch {}
      }
    }
  } catch {}

  const explorerFileActions: MenuItemConstructorOptions[] = rendererMenuState.fileActions.visible
    ? [
        {
          label: 'New File',
          accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
          enabled: rendererMenuState.fileActions.canCreateFile,
          click: () => sendMenuEvent('menu:new-file'),
        },
        {
          label: 'Open File…',
          accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
          enabled: rendererMenuState.fileActions.canOpenFile,
          click: () => sendMenuEvent('menu:open-file'),
        },
        {
          label: 'Save',
          accelerator: isMac ? 'Cmd+S' : 'Ctrl+S',
          enabled: rendererMenuState.fileActions.canSave,
          click: () => sendMenuEvent('menu:save-file'),
        },
        {
          label: 'Save As…',
          accelerator: isMac ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
          enabled: rendererMenuState.fileActions.canSaveAs,
          click: () => sendMenuEvent('menu:save-file-as'),
        },
      ]
    : []

  const workspaceActions: MenuItemConstructorOptions[] = [
    {
      label: 'New Window',
      accelerator: isMac ? 'Cmd+Shift+N' : 'Ctrl+Shift+N',
      click: () => createWindow({ offsetFromCurrent: true }),
    },
    {
      label: 'Open Folder…',
      accelerator: isMac ? 'Cmd+Shift+O' : 'Ctrl+Shift+O',
      click: () => sendMenuEvent('menu:open-folder'),
    },
    {
      label: 'Open Recent',
      submenu:
        recentFolders.length > 0
          ? (recentFolders.map((folder) => ({
              label: folder.path,
              click: () => sendMenuEvent('menu:open-recent-folder', folder.path),
            })) as MenuItemConstructorOptions[])
          : ([{ label: 'No Recent Folders', enabled: false }] as MenuItemConstructorOptions[]),
    },
    {
      label: 'Close Workspace',
      accelerator: isMac ? 'Cmd+Shift+W' : 'Ctrl+Shift+W',
      click: () => sendMenuEvent('menu:close-workspace'),
    },
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' as const }] as MenuItemConstructorOptions[]) : []),
    {
      label: 'File',
      submenu: [
        ...explorerFileActions,
        ...(explorerFileActions.length ? ([{ type: 'separator' as const }] as MenuItemConstructorOptions[]) : []),
        ...workspaceActions,
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Files…',
          accelerator: isMac ? 'Cmd+Shift+F' : 'Ctrl+Shift+F',
          enabled: rendererMenuState.view === 'explorer',
          click: () => sendMenuEvent('menu:find-in-files'),
        },
        {
          label: 'Replace in Files…',
          accelerator: isMac ? 'Cmd+Shift+H' : 'Ctrl+Shift+H',
          enabled: rendererMenuState.view === 'explorer',
          click: () => sendMenuEvent('menu:replace-in-files'),
        },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: 'View',
      submenu: [
        ...VIEW_SHORTCUTS.map((entry) => ({
          label: entry.label,
          accelerator: entry.accelerator,
          type: 'checkbox' as const,
          checked: rendererMenuState.view === entry.view,
          click: () => sendMenuEvent(entry.channel),
        })),
        { type: 'separator' },
        {
          label: 'Toggle Terminal Panel',
          accelerator: isMac ? 'Cmd+`' : 'Ctrl+`',
          enabled: rendererMenuState.view === 'explorer',
          click: () => sendMenuEvent('menu:toggle-terminal-panel'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([{ type: 'separator' as const }, { role: 'front' }] as MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as MenuItemConstructorOptions[])),
      ] as MenuItemConstructorOptions[],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: () => shell.openExternal('https://github.com/joeleaver/HiFide'),
        },
        { type: 'separator' },
        {
          label: 'View Logs',
          click: () => shell.openPath(app.getPath('logs')),
        },
      ] as MenuItemConstructorOptions[],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  menuRefs.file = menu.items.find((item) => item.label === 'File')?.submenu ?? undefined
  menuRefs.edit = menu.items.find((item) => item.label === 'Edit')?.submenu ?? undefined
  menuRefs.view = menu.items.find((item) => item.label === 'View')?.submenu ?? undefined
  menuRefs.window = menu.items.find((item) => item.label === 'Window')?.submenu ?? undefined
  menuRefs.help = menu.items.find((item) => item.label === 'Help')?.submenu ?? undefined
}

export function registerMenuHandlers(ipc: IpcMain) {
  ipc.handle('menu:get-current-view', () => rendererMenuState.view)
  ipc.handle('menu:set-view', (_event, view: ViewType) => {
    setCurrentViewForMenu(view)
    return rendererMenuState.view
  })

  // app:set-view IPC handler removed - view changes now handled via WebSocket RPC (view.set)



  ipc.handle('menu:popup', (event, menuOrArgs: any, x?: number, y?: number) => {
    let name: keyof typeof menuRefs | undefined
    let px: number | undefined
    let py: number | undefined

    // Support both positional args and single-object payload
    if (menuOrArgs && typeof menuOrArgs === 'object' && typeof menuOrArgs.menu === 'string') {
      name = menuOrArgs.menu as keyof typeof menuRefs
      px = Number(menuOrArgs.x)
      py = Number(menuOrArgs.y)
    } else {
      name = menuOrArgs as keyof typeof menuRefs
      px = x
      py = y
    }

    const submenu = name ? menuRefs[name] : undefined
    if (submenu) {
      const ox = (typeof px === 'number' && Number.isFinite(px)) ? Math.round(px) : undefined
      const oy = (typeof py === 'number' && Number.isFinite(py)) ? Math.round(py) : undefined
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined

      // Only include x/y if valid to avoid NativeConversion errors on Windows
      const opts: any = { window: win }
      if (typeof ox === 'number') opts.x = ox
      if (typeof oy === 'number') opts.y = oy
      submenu.popup(opts)
    }
  })
}

export function unregisterMenuHandlers(ipc: IpcMain) {
  ipc.removeHandler('menu:get-current-view')
  ipc.removeHandler('menu:set-view')
  ipc.removeHandler('menu:popup')


}
