/**
 * Menu and window control IPC handlers
 */

import type { IpcMain, MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, Menu, shell, app } from 'electron'
import { getWindow, windowStateStore } from '../core/state'
import type { ViewType } from '../store/types'

let currentViewForMenu: ViewType = 'agent'

const menuRefs: {
  file?: Electron.Menu
  edit?: Electron.Menu
  view?: Electron.Menu
  window?: Electron.Menu
  help?: Electron.Menu
} = {}

const VIEW_SHORTCUTS: Array<{ view: ViewType; label: string; accelerator: string; channel: string }> = [
  { view: 'agent', label: 'Chat', accelerator: process.platform === 'darwin' ? 'Cmd+1' : 'Ctrl+1', channel: 'menu:open-chat' },
  { view: 'flowEditor' as ViewType, label: 'Flow Editor', accelerator: process.platform === 'darwin' ? 'Cmd+2' : 'Ctrl+2', channel: 'menu:open-flow-editor' },
  { view: 'kanban', label: 'Kanban Board', accelerator: process.platform === 'darwin' ? 'Cmd+3' : 'Ctrl+3', channel: 'menu:open-kanban' },
  { view: 'settings', label: 'Settings', accelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,', channel: 'menu:open-settings' },
]

function sendMenuEvent(channel: string, ...args: any[]) {
  const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
  wc?.send(channel, ...args)
}

export function setCurrentViewForMenu(view: ViewType) {
  currentViewForMenu = view
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  let recentFolders: Array<{ path: string; lastOpened: number }> = []
  try {
    const stored = windowStateStore.get('recentFolders')
    if (Array.isArray(stored)) {
      recentFolders = stored.slice(0, 10)
    }
  } catch {}

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' as const }] as MenuItemConstructorOptions[]) : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
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
        { type: 'separator' },
        {
          label: 'Close Workspace',
          accelerator: isMac ? 'Cmd+Shift+W' : 'Ctrl+Shift+W',
          click: () => sendMenuEvent('menu:close-workspace'),
        },
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
      ] as MenuItemConstructorOptions[],
    },
    {
      label: 'View',
      submenu: [
        ...VIEW_SHORTCUTS.map((entry) => ({
          label: entry.label,
          accelerator: entry.accelerator,
          type: 'checkbox' as const,
          checked: currentViewForMenu === entry.view,
          click: () => sendMenuEvent(entry.channel),
        })),
        { type: 'separator' },
        {
          label: 'Toggle Terminal Panel',
          accelerator: isMac ? 'Cmd+`' : 'Ctrl+`',
          enabled: currentViewForMenu === 'explorer',
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
  ipc.handle('menu:get-current-view', () => currentViewForMenu)
  ipc.handle('menu:set-view', (_event, view: ViewType) => {
    setCurrentViewForMenu(view)
    buildMenu()
  })

  // Also support renderer-side app.setView bridge
  ipc.handle('app:set-view', (_event, view: ViewType) => {
    setCurrentViewForMenu(view)
    buildMenu()
  })

  // Window control handlers (for custom titlebar buttons)
  ipc.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || getWindow()
    try { win?.minimize() } catch {}
    return { ok: true }
  })

  ipc.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || getWindow()
    if (win) {
      try {
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        return { ok: true, isMaximized: win.isMaximized() }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    }
    return { ok: false, error: 'no-window' }
  })

  ipc.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || getWindow()
    try { win?.close() } catch {}
    return { ok: true }
  })


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

  // Window control handlers
  ipc.removeHandler('window:minimize')
  ipc.removeHandler('window:maximize')
  ipc.removeHandler('window:close')
}
