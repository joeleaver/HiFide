/**
 * Renderer-Only Terminal Store
 *
 * MINIMAL store for xterm.js mounting and PTY communication.
 * Main process handles ALL PTY session management.
 * 
 * Responsibilities:
 * - Mount/unmount xterm.js instances to DOM
 * - Subscribe to PTY data events from main process
 * - Write user input to PTY (explorer terminals only)
 */

import { create } from 'zustand'
import * as ptySvc from '../services/pty'
import * as terminalInstances from '../services/terminalInstances'

interface TerminalStore {
  // Event infrastructure
  eventsInitialized: boolean

  // Data subscribers (tabId -> callback)
  dataSubscribers: Record<string, ((data: string) => void) | undefined>

  // PTY session IDs (tabId -> sessionId) - just for tracking
  sessionIds: Record<string, string>

  // UI state
  agentTerminalPanelOpen: boolean
  explorerTerminalPanelOpen: boolean

  // Actions
  initEvents: () => void
  mountTerminal: (params: { tabId: string; container: HTMLElement; sessionId: string }) => Promise<void>
  unmountTerminal: (tabId: string) => void
  fitTerminal: (tabId: string) => void
  setTerminalPanelOpen: (context: 'agent' | 'explorer', open: boolean) => void
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  eventsInitialized: false,
  dataSubscribers: {},
  sessionIds: {},
  agentTerminalPanelOpen: true,
  explorerTerminalPanelOpen: true,

  initEvents: () => {
    if (get().eventsInitialized) return

    // Subscribe to PTY data events from main process
    ptySvc.onData(({ sessionId, data }: { sessionId: string; data: string }) => {
      // Find which tab is using this session
      const tabId = Object.keys(get().sessionIds).find(tid => get().sessionIds[tid] === sessionId)
      const subscriber = tabId ? get().dataSubscribers[tabId] : undefined
      if (subscriber) subscriber(data)
    })

    // Subscribe to PTY exit events
    ptySvc.onExit(({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
      const tabId = Object.keys(get().sessionIds).find(tid => get().sessionIds[tid] === sessionId)
      const subscriber = tabId ? get().dataSubscribers[tabId] : undefined
      if (subscriber) {
        subscriber(`\r\n[process exited with code ${exitCode}]\r\n`)
      }

      // Clear the session tracking so the component will remount
      if (tabId) {
        const { [tabId]: __, ...restSessions } = get().sessionIds
        set({ sessionIds: restSessions })
      }
    })

    set({ eventsInitialized: true })
  },

  mountTerminal: async ({ tabId, container, sessionId }) => {
    get().initEvents()

    // Create and mount xterm instance
    const instance = terminalInstances.createTerminalInstance(tabId)
    instance.terminal.options.disableStdin = true // Agent terminals are read-only
    terminalInstances.mountTerminalInstance(tabId, container)

    // Wait for fonts and fit
    try {
      await (document as any).fonts?.ready
    } catch {}
    terminalInstances.fitTerminalInstance(tabId)

    // Attach to PTY in main process
    const cols = instance.terminal.cols
    const rows = instance.terminal.rows
    
    try {
      const result = await ptySvc.attachAgent({ requestId: sessionId, tailBytes: 400 })
      if (!result?.ok) {
        throw new Error('Failed to attach to PTY')
      }

      // Track the session ID
      set({ sessionIds: { ...get().sessionIds, [tabId]: sessionId } })

      // Subscribe to data
      set({
        dataSubscribers: {
          ...get().dataSubscribers,
          [tabId]: (data: string) => {
            try {
              instance.terminal.write(data)
            } catch {}
          }
        }
      })

      // Resize PTY to match terminal
      await ptySvc.resize(sessionId, cols, rows)
    } catch (err: any) {
      instance.terminal.writeln(`\r\n[PTY Error: ${err?.message || String(err)}]`)
    }
  },

  unmountTerminal: (tabId) => {
    terminalInstances.unmountTerminalInstance(tabId)
    
    // Clean up subscribers and session tracking
    const { [tabId]: __, ...restSubs } = get().dataSubscribers
    const { [tabId]: ___, ...restSessions } = get().sessionIds
    set({ dataSubscribers: restSubs, sessionIds: restSessions })
  },

  fitTerminal: (tabId) => {
    terminalInstances.fitTerminalInstance(tabId)

    // Resize PTY to match
    const instance = terminalInstances.getTerminalInstance(tabId)
    const sessionId = get().sessionIds[tabId]
    if (instance && sessionId) {
      ptySvc.resize(sessionId, instance.terminal.cols, instance.terminal.rows)
    }
  },

  setTerminalPanelOpen: (context, open) => {
    if (context === 'agent') {
      set({ agentTerminalPanelOpen: open })
    } else {
      set({ explorerTerminalPanelOpen: open })
    }
  },
}))

