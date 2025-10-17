/**
 * Terminal Instances Service (Main Process)
 * 
 * In the main process, we don't manage xterm.js instances.
 * This is a stub for compatibility with the terminal slice.
 * The actual terminal instances are managed in the renderer process.
 */

export interface TerminalInstance {
  terminal: any
  fitAddon: any
  container: HTMLElement | null
  resizeObserver: ResizeObserver | null
  resizeTimeout: NodeJS.Timeout | null
}

// Stub implementations - not used in main process
export function getTerminalInstance(_tabId: string): TerminalInstance | undefined {
  return undefined
}

export function createTerminalInstance(_tabId: string): TerminalInstance {
  throw new Error('Terminal instances are managed in renderer process')
}

export function deleteTerminalInstance(_tabId: string): void {
  // No-op in main process
}

export function mountTerminalInstance(_tabId: string, _container: HTMLElement): TerminalInstance | undefined {
  return undefined
}

export function unmountTerminalInstance(_tabId: string): void {
  // No-op in main process
}

export function fitTerminalInstance(_tabId: string): void {
  // No-op in main process
}

export function disposeTerminalInstance(_tabId: string): void {
  // No-op in main process
}

