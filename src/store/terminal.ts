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
  mountTerminal: (params: { tabId: string; container: HTMLElement; context: 'agent' | 'explorer'; sessionId?: string }) => Promise<void>
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

  // Mount terminal for either agent (attach to agent PTY) or explorer (create a new PTY)
  mountTerminal: async ({ tabId, container, context, sessionId }) => {
    get().initEvents()

    // Create xterm instance but delay opening until fonts and layout are ready
    const instance = terminalInstances.createTerminalInstance(tabId)
    instance.terminal.options.disableStdin = (context === 'agent')
    instance.terminal.options.convertEol = true

    // Ensure fonts and layout are ready before opening to avoid xterm viewport errors
    try { await (document as any).fonts?.ready } catch {}

    // Wait for a frame and until container has non-zero size
    const waitNextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
    let attempts = 0
    while ((container.clientWidth === 0 || container.clientHeight === 0) && attempts < 10) {
      await waitNextFrame()
      attempts++
    }

    // Now open/mount and fit
    terminalInstances.mountTerminalInstance(tabId, container)
    terminalInstances.fitTerminalInstance(tabId)

    // Compute size for PTY
    let cols = instance.terminal.cols
    let rows = instance.terminal.rows
    if (!cols || !rows) {
      // Attempt another fit if initial measurement was zero
      terminalInstances.fitTerminalInstance(tabId)
      cols = instance.terminal.cols
      rows = instance.terminal.rows
    }

    try {
      if (context === 'agent') {
        if (!sessionId) throw new Error('No agent sessionId provided')

        const prev = get().sessionIds[tabId]

        // Map this tab to the target session BEFORE attaching so tail/data delivered during attach
        set({ sessionIds: { ...get().sessionIds, [tabId]: sessionId } })

        // Install data subscriber BEFORE attach so any tail sent immediately is rendered
        set({
          dataSubscribers: {
            ...get().dataSubscribers,
            [tabId]: (data: string) => {
              try { instance.terminal.write(data) } catch {}
            }
          }
        })

        // For first attach, request a small tail so users see an initial prompt/output.
        const tailBytes = prev ? 0 : 500
        const result = await ptySvc.attachAgent({ requestId: sessionId, tailBytes })
        if (!result?.ok) {
          const reason = (result as any)?.error ? ` (${(result as any).error})` : ''
          throw new Error(`Failed to attach to PTY${reason}`)
        }

        // Resize PTY to match terminal dimensions after attach (guard against zeros)
        if (cols && rows) {
          await ptySvc.resize(sessionId, cols, rows)
        }
      } else {
        // Explorer terminal: create or reuse a PTY session
        let sid = get().sessionIds[tabId]
        if (!sid) {
          // Use workspace root as cwd if available
          try {
            const { useAppStore } = await import('../store')
            const cwd = useAppStore.getState().workspaceRoot || undefined
            const res = await ptySvc.create({ cols: cols || 80, rows: rows || 24, cwd })
            if (!res || !res.sessionId) throw new Error('Failed to create PTY')
            sid = res.sessionId
          } catch (e: any) {
            throw new Error(e?.message || 'Failed to create PTY')
          }
        }

        // Map tab -> session and install subscriber
        set({ sessionIds: { ...get().sessionIds, [tabId]: sid } })
        set({
          dataSubscribers: {
            ...get().dataSubscribers,
            [tabId]: (data: string) => {
              try { instance.terminal.write(data) } catch {}
            }
          }
        })

        // Route terminal input to PTY for explorer terminals
        instance.terminal.options.disableStdin = false
        try {
          instance.terminal.onData((data: string) => {
            try { ptySvc.write(sid!, data) } catch {}
          })
        } catch {}

        // Sync PTY size
        if (cols && rows) {
          await ptySvc.resize(sid!, cols, rows)
        }
      }
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

