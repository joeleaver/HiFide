/**
 * Mock Electron module for testing
 */

export const ipcMain = {
  on: jest.fn(),
  handle: jest.fn(),
  removeHandler: jest.fn(),
}

export const ipcRenderer = {
  on: jest.fn(),
  send: jest.fn(),
  invoke: jest.fn(),
}

export const app = {
  getPath: jest.fn((name: string) => {
    if (name === 'userData') return '/mock/user/data'
    return '/mock/path'
  }),
  quit: jest.fn(),
}

export const BrowserWindow = jest.fn().mockImplementation(() => ({
  loadURL: jest.fn(),
  loadFile: jest.fn(),
  on: jest.fn(),
  webContents: {
    send: jest.fn(),
    on: jest.fn(),
  },
}))

export const dialog = {
  showOpenDialog: jest.fn(),
  showSaveDialog: jest.fn(),
  showMessageBox: jest.fn(),
}

