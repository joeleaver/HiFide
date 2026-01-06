/**
 * Terminal Instances Manager
 * 
 * Manages xterm.js Terminal and FitAddon instances outside of Zustand store.
 * This keeps the store serializable while maintaining terminal instances in memory.
 * 
 * The store only keeps terminal metadata (IDs, context, PTY session IDs).
 * This module manages the actual Terminal instances, FitAddons, and DOM elements.
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/**
 * Terminal instance with all non-serializable objects
 */
export interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  container: HTMLElement | null
  resizeObserver: ResizeObserver | null
  resizeTimeout: NodeJS.Timeout | null
  isOpen: boolean  // Track if open() has been called
}

/**
 * In-memory storage for terminal instances
 * Key: terminal tab ID
 * Value: TerminalInstance
 */
const terminalInstances = new Map<string, TerminalInstance>()

/**
 * Get a terminal instance by tab ID
 */
export function getTerminalInstance(tabId: string): TerminalInstance | undefined {
  return terminalInstances.get(tabId)
}

/**
 * Create and store a new terminal instance
 */
export function createTerminalInstance(tabId: string): TerminalInstance {
  // Clean up existing instance if any
  disposeTerminalInstance(tabId)
  
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5',
    },
  })
  
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  
  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    container: null,
    resizeObserver: null,
    resizeTimeout: null,
    isOpen: false,  // Not opened yet
  }

  terminalInstances.set(tabId, instance)
  return instance
}

/**
 * Mount a terminal instance to a DOM container
 */
export function mountTerminalInstance(
  tabId: string,
  container: HTMLElement
): TerminalInstance | undefined {
  const instance = terminalInstances.get(tabId)
  if (!instance) {
    return undefined
  }

  // Check if open() has been called on this terminal
  if (instance.isOpen) {
    // Terminal has been opened before - move the element to new container
    const terminalElement = instance.terminal.element
    if (terminalElement) {
      console.log('[terminalInstances] Moving terminal element to new container:', tabId)
      if (terminalElement.parentElement) {
        terminalElement.parentElement.removeChild(terminalElement)
      }
      container.appendChild(terminalElement)
    } else {
      console.error('[terminalInstances] Terminal marked as open but has no element:', tabId)
    }
  } else {
    // First time opening this terminal
    console.log('[terminalInstances] Opening terminal for first time:', tabId)
    instance.terminal.open(container)
    instance.isOpen = true

    // Add right-click behavior: copy if selection exists, otherwise paste
    const term = instance.terminal
    const el = term.element
    if (el) {
      el.addEventListener('contextmenu', async (e) => {
        e.preventDefault()
        if (term.hasSelection()) {
          const selection = term.getSelection()
          try {
            await navigator.clipboard.writeText(selection)
            term.clearSelection()
          } catch (err) {
            console.error('[terminalInstances] Failed to copy to clipboard:', err)
          }
        } else if (!term.options.disableStdin) {
          try {
            const text = await navigator.clipboard.readText()
            if (text) {
              term.paste(text)
            }
          } catch (err) {
            console.error('[terminalInstances] Failed to read from clipboard:', err)
          }
        }
      })
    }
  }

  instance.container = container

  // Fit terminal to container only if visible/non-zero size
  try {
    const w = container?.clientWidth || 0
    const h = container?.clientHeight || 0
    if (w > 0 && h > 0) {
      instance.fitAddon.fit()
    }
  } catch (e) {
    console.error('[terminalInstances] Failed to fit terminal:', e)
  }

  // Set up resize observer
  if (instance.resizeObserver) {
    instance.resizeObserver.disconnect()
  }

  instance.resizeObserver = new ResizeObserver(() => {
    if (instance.resizeTimeout) {
      clearTimeout(instance.resizeTimeout)
    }

    instance.resizeTimeout = setTimeout(() => {
      try {
        const w = container?.clientWidth || 0
        const h = container?.clientHeight || 0
        if (w > 0 && h > 0) {
          instance.fitAddon.fit()
        }
      } catch (e) {
        console.error('[terminalInstances] Failed to fit terminal on resize:', e)
      }
    }, 100)
  })

  instance.resizeObserver.observe(container)
  
  return instance
}

/**
 * Unmount a terminal instance from its container
 */
export function unmountTerminalInstance(tabId: string): void {
  const instance = terminalInstances.get(tabId)
  if (!instance) return

  // Disconnect resize observer
  if (instance.resizeObserver) {
    instance.resizeObserver.disconnect()
    instance.resizeObserver = null
  }

  // Clear resize timeout
  if (instance.resizeTimeout) {
    clearTimeout(instance.resizeTimeout)
    instance.resizeTimeout = null
  }

  // Note: We don't clear instance.container here because we use it to detect
  // if the terminal is already open when remounting
  // The terminal element stays in the DOM until the component is destroyed
}

/**
 * Fit a terminal instance to its container
 */
export function fitTerminalInstance(tabId: string): void {
  const instance = terminalInstances.get(tabId)
  if (!instance) return
  
  try {
    const container = instance.container
    const w = container?.clientWidth || 0
    const h = container?.clientHeight || 0
    if (w > 0 && h > 0) {
      instance.fitAddon.fit()
    }
  } catch (e) {
    console.error('[terminalInstances] Failed to fit terminal:', e)
  }
}

/**
 * Dispose a terminal instance and clean up all resources
 */
export function disposeTerminalInstance(tabId: string): void {
  const instance = terminalInstances.get(tabId)
  if (!instance) return
  
  // Unmount first
  unmountTerminalInstance(tabId)
  
  // Dispose terminal
  try {
    instance.terminal.dispose()
  } catch (e) {
    console.error('[terminalInstances] Failed to dispose terminal:', e)
  }
  
  // Remove from map
  terminalInstances.delete(tabId)
}

/**
 * Get all terminal instance IDs
 */
export function getAllTerminalInstanceIds(): string[] {
  return Array.from(terminalInstances.keys())
}

/**
 * Clear all terminal instances
 */
export function clearAllTerminalInstances(): void {
  for (const tabId of terminalInstances.keys()) {
    disposeTerminalInstance(tabId)
  }
}

