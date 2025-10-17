/**
 * Menu and window control IPC handlers
 * 
 * Handles application menu building and window controls
 */

import type { IpcMain, MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, Menu, shell } from 'electron'
import { getWindow, windowStateStore } from '../core/state'

/**
 * Current view for menu state
 */
let currentViewForMenu: 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings' | 'flowEditor' = 'agent'

/**
 * Menu references for popup
 */
const menuRefs: {
  file?: Electron.Menu
  edit?: Electron.Menu
  view?: Electron.Menu
  window?: Electron.Menu
  help?: Electron.Menu
} = {}

/**
 * Build the application menu
 */
export function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  // Get recent folders from window state store
  let recentFolders: Array<{ path: string; lastOpened: number }> = []
  try {
    const stored = windowStateStore.get('recentFolders')
    if (Array.isArray(stored)) {
      recentFolders = stored.slice(0, 10)
    }
  } catch {}

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        // Flow Editor specific menu items
        ...(currentViewForMenu === 'flowEditor' ? [
          {
            label: 'New Flow',
            accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:flow-new')
            },
          },
          {
            label: 'Open Flow...',
            accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:flow-open')
            },
          },
          {
            label: 'Save Flow',
            accelerator: isMac ? 'Cmd+S' : 'Ctrl+S',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:flow-save')
            },
          },
          {
            label: 'Save Flow As...',
            accelerator: isMac ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:flow-save-as')
            },
          },
          { type: 'separator' as const },
        ] : []),
        // Agent view specific menu items
        ...(currentViewForMenu === 'agent' ? [
          {
            label: 'Import Flow...',
            accelerator: isMac ? 'Cmd+I' : 'Ctrl+I',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:import-flow')
            },
          },
          {
            label: 'Export Flow...',
            accelerator: isMac ? 'Cmd+E' : 'Ctrl+E',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:export-flow')
            },
          },
          { type: 'separator' as const },
        ] : []),
        // Standard menu items for other views
        ...(currentViewForMenu !== 'flowEditor' ? [
          {
            label: 'Open Folder...',
            accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
            click: () => {
              const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
              wc?.send('menu:open-folder')
            },
          },
          {
            label: 'Open Recent',
            submenu: recentFolders.length > 0
              ? [
                  ...recentFolders.map(folder => ({
                    label: folder.path,
                    click: () => {
                      const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
                      wc?.send('menu:open-recent-folder', folder.path)
                    },
                  })),
                  { type: 'separator' as const },
                  {
                    label: 'Clear Recently Opened',
                    click: () => {
                      const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
                      wc?.send('menu:clear-recent-folders')
                    },
                  },
                ]
              : [{ label: 'No Recent Folders', enabled: false }],
          },
          { type: 'separator' as const },
        ] : []),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
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
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Chat',
          accelerator: isMac ? 'Cmd+1' : 'Ctrl+1',
          click: () => {
            const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
            wc?.send('menu:open-chat')
          },
        },
        {
          label: 'Flow Editor',
          accelerator: isMac ? 'Cmd+2' : 'Ctrl+2',
          click: () => {
            const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
            wc?.send('menu:open-flow-editor')
          },
        },
        {
          label: 'Settings',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
            wc?.send('menu:open-settings')
          },
        },
        {
          label: 'Toggle Terminal Panel',
          accelerator: isMac ? 'Cmd+`' : 'Ctrl+`',
          enabled: currentViewForMenu === 'explorer',
          click: () => {
            const wc = BrowserWindow.getFocusedWindow()?.webContents || getWindow()?.webContents
            wc?.send('menu:toggle-terminal-panel')
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu' as const,
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://electronjs.org')
          },
        },
      ],
    },
  ]

  const appMenu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(appMenu)

  // Cache submenus for popup (Windows/Linux). On macOS we still allow popup for consistency.
  const items = appMenu.items
  menuRefs.file = items.find(i => i.label === 'File')?.submenu || menuRefs.file
  menuRefs.edit = items.find(i => i.label === 'Edit')?.submenu || menuRefs.edit
  menuRefs.view = items.find(i => i.label === 'View')?.submenu || menuRefs.view
  menuRefs.window = items.find(i => i.role === 'windowMenu')?.submenu || items.find(i => i.label === 'Window')?.submenu || menuRefs.window
  menuRefs.help = items.find(i => i.label === 'Help')?.submenu || menuRefs.help
}

/**
 * Register menu and window control IPC handlers
 */
export function registerMenuHandlers(ipcMain: IpcMain): void {
  /**
   * Popup a menu at specified coordinates
   */
  ipcMain.handle('menu:popup', (_e, args: { menu: 'file' | 'edit' | 'view' | 'window' | 'help'; x?: number; y?: number }) => {
    const m = menuRefs[args.menu]
    const win = getWindow()
    if (!win || !m) return

    // Position menu below the menu item
    if (args.x !== undefined && args.y !== undefined) {
      m.popup({ window: win, x: Math.round(args.x), y: Math.round(args.y) })
    } else {
      m.popup({ window: win })
    }
  })

  /**
   * Update menu item enablement when renderer view changes
   */
  ipcMain.handle('app:set-view', (_e, view: 'agent' | 'explorer' | 'sourceControl' | 'terminal' | 'settings' | 'flowEditor') => {
    currentViewForMenu = view
    buildMenu() // Rebuild menu to show/hide contextual items
    const appMenu = Menu.getApplicationMenu()
    const viewMenu = appMenu?.items.find(i => i.label === 'View')?.submenu
    const toggleItem = viewMenu?.items.find(i => i.label === 'Toggle Terminal Panel')
    if (toggleItem) {
      toggleItem.enabled = view === 'explorer'
    }
  })

  /**
   * Window controls
   */
  ipcMain.handle('window:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return win.isMaximized()
  })

  ipcMain.handle('window:close', () => {
    getWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return getWindow()?.isMaximized()
  })
}

