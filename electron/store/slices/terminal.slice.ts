/**
 * Terminal Slice
 *
 * Manages terminal tabs, instances, and PTY sessions.
 *
 * Responsibilities:
 * - Terminal tabs (agent/explorer contexts)
 * - Active terminal tracking
 * - Terminal instances (xterm.js)
 * - PTY sessions and routing
 * - Mount/unmount/fit logic
 * - Terminal cleanup
 *
 * Dependencies:
 * - Workspace slice (for workspace root/cwd)
 * - Session slice (for current request ID)
 */

import type { StateCreator } from 'zustand'
import type { PtySession } from '../types'
import * as ptySvc from '../../services/pty'
import * as terminalInstances from '../../services/terminalInstances'
import { DEFAULTS } from '../utils/constants'

// ============================================================================
// Types
// ============================================================================

export interface TerminalSlice {
  // Terminal Tabs State
  agentTerminalTabs: string[]
  agentActiveTerminal: string | null
  explorerTerminalTabs: string[]
  explorerActiveTerminal: string | null
  agentSessionTerminals: Record<string, string[]>

  // PTY State
  ptyInitialized: boolean
  ptySessions: Record<string, PtySession>
  ptyBySessionId: Record<string, string>
  ptySubscribers: Record<string, ((data: string) => void) | undefined>

  // Terminal Tab Actions
  addTerminalTab: (context: 'agent' | 'explorer') => string
  removeTerminalTab: (params: { context: 'agent' | 'explorer'; tabId: string }) => void
  setActiveTerminal: (params: { context: 'agent' | 'explorer'; tabId: string | null }) => void
  clearAgentTerminals: () => Promise<void>
  clearExplorerTerminals: () => Promise<void>

  // Session Terminal Management
  ensureSessionTerminal: () => Promise<void>

  // Terminal Instance Actions
  mountTerminal: (params: { tabId: string; container: HTMLElement; context: 'agent' | 'explorer' }) => Promise<void>
  remountTerminal: (params: { tabId: string; container: HTMLElement }) => void
  unmountTerminal: (tabId: string) => void
  fitTerminal: (tabId: string) => void
  fitAllTerminals: (context: 'agent' | 'explorer') => void

  // PTY Actions
  ensurePtyInfra: () => void
  ensurePtySession: (params: { tabId: string; opts?: { cwd?: string; shell?: string; cols?: number; rows?: number; context?: 'agent' | 'explorer' } }) => Promise<{ sessionId: string }>
  writePty: (params: { tabId: string; data: string }) => Promise<{ ok: boolean }>
  resizePty: (params: { tabId: string; cols: number; rows: number }) => Promise<{ ok: boolean }>
  disposePty: (tabId: string) => Promise<{ ok: boolean }>
  subscribePtyData: (params: { tabId: string; fn: (data: string) => void }) => () => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createTerminalSlice: StateCreator<TerminalSlice, [], [], TerminalSlice> = (set, get) => ({
  // State
  agentTerminalTabs: [],
  agentActiveTerminal: null,
  explorerTerminalTabs: [],
  explorerActiveTerminal: null,
  agentSessionTerminals: {},

  ptyInitialized: false,
  ptySessions: {},
  ptyBySessionId: {},
  ptySubscribers: {},
  
  // Terminal Tab Actions
  addTerminalTab: (context: 'agent' | 'explorer') => {
    const prefix = context === 'agent' ? 'a' : 'e'
    const tabId = `${prefix}${crypto.randomUUID().slice(0, 7)}`
    
    if (context === 'agent') {
      set((state) => ({
        agentTerminalTabs: [...state.agentTerminalTabs, tabId],
        agentActiveTerminal: tabId,
      }))
    } else {
      set((state) => ({
        explorerTerminalTabs: [...state.explorerTerminalTabs, tabId],
        explorerActiveTerminal: tabId,
      }))
    }
    
    return tabId
  },
  
  removeTerminalTab: ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
    const state = get()

    // Unmount and dispose
    state.unmountTerminal(tabId)
    state.disposePty(tabId)
    
    if (context === 'agent') {
      const tabs = state.agentTerminalTabs.filter((id) => id !== tabId)
      const active = state.agentActiveTerminal === tabId ? (tabs[0] || null) : state.agentActiveTerminal
      set({ agentTerminalTabs: tabs, agentActiveTerminal: active })
    } else {
      const tabs = state.explorerTerminalTabs.filter((id) => id !== tabId)
      const active = state.explorerActiveTerminal === tabId ? (tabs[0] || null) : state.explorerActiveTerminal
      set({ explorerTerminalTabs: tabs, explorerActiveTerminal: active })
    }
    
  },
  
  setActiveTerminal: ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string | null }) => {
    if (context === 'agent') {
      set({ agentActiveTerminal: tabId })
    } else {
      set({ explorerActiveTerminal: tabId })
    }
  },
  
  clearAgentTerminals: async () => {
    const state = get()
    
    // Unmount and dispose all agent terminals
    await Promise.all(
      state.agentTerminalTabs.map((tabId) => {
        state.unmountTerminal(tabId)
        return state.disposePty(tabId)
      })
    )
    
    // Clear agent terminal state
    set({ agentTerminalTabs: [], agentActiveTerminal: null })
    
    // Enforce at least one agent terminal after clearing
    const newId = `a${crypto.randomUUID().slice(0, 7)}`
    set({ agentTerminalTabs: [newId], agentActiveTerminal: newId })
    
  },
  
  clearExplorerTerminals: async () => {
    const state = get()

    // Unmount and dispose all explorer terminals
    await Promise.all(
      state.explorerTerminalTabs.map((tabId) => {
        state.unmountTerminal(tabId)
        return state.disposePty(tabId)
      })
    )

    // Clear explorer terminal state
    set({ explorerTerminalTabs: [], explorerActiveTerminal: null })

  },

  /**
   * Ensure a terminal exists for the current session
   * - Creates exactly one terminal tab if none exists
   * - Binds to the session's PTY (via currentRequestId)
   * - Automatically restarts if terminal exits
   */
  ensureSessionTerminal: async () => {
    const state = get() as any
    const currentSessionId = state.currentId

    console.log('[terminal] ensureSessionTerminal called:', { currentSessionId, hasCurrentId: !!currentSessionId })

    if (!currentSessionId) {
      console.warn('[terminal] ensureSessionTerminal: no current session')
      return
    }

    // Check if we already have a terminal for this session
    const existingTabs = state.agentTerminalTabs || []

    if (existingTabs.length === 0) {
      // No terminals exist - create one
      const tabId = `a${crypto.randomUUID().slice(0, 7)}`
      set({
        agentTerminalTabs: [tabId],
        agentActiveTerminal: tabId,
      })
      console.log('[terminal] Created session terminal:', tabId, 'for session:', currentSessionId)
    } else {
      // Terminal already exists - ensure it's active
      if (!state.agentActiveTerminal) {
        set({ agentActiveTerminal: existingTabs[0] })
      }
      console.log('[terminal] Session terminal already exists:', existingTabs[0], 'for session:', currentSessionId)
    }
  },
  
  // Terminal Instance Actions
  mountTerminal: async ({ tabId, container, context }: { tabId: string; container: HTMLElement; context: 'agent' | 'explorer' }) => {
    const state = get()

    // Create terminal instance using the service
    const instance = terminalInstances.createTerminalInstance(tabId)

    // Configure terminal for context
    instance.terminal.options.disableStdin = context === 'agent'

    // Mount terminal to container
    terminalInstances.mountTerminalInstance(tabId, container)

    // Wait for fonts to load
    try {
      await (document as any).fonts?.ready
    } catch {}

    // Fit again after fonts load
    terminalInstances.fitTerminalInstance(tabId)

    // Create PTY session
    const cols = instance.terminal.cols
    const rows = instance.terminal.rows

    try {
      await state.ensurePtySession({ tabId, opts: { cols, rows, context } })

      // Subscribe to PTY data and write to terminal
      state.subscribePtyData({ tabId, fn: (data: string) => {
        try {
          instance.terminal.write(data)
        } catch {}
      }})

      // Route terminal input to PTY (if not disabled)
      if (context !== 'agent') {
        instance.terminal.onData((data: string) => state.writePty({ tabId, data }))
      }
    } catch (err: any) {
      instance.terminal.writeln(`\r\n[PTY Error: ${err?.message || String(err)}]`)
    }

  },
  
  remountTerminal: ({ tabId, container }: { tabId: string; container: HTMLElement }) => {
    const state = get()
    const instance = terminalInstances.getTerminalInstance(tabId)
    if (!instance) return

    // Unmount from old container
    terminalInstances.unmountTerminalInstance(tabId)

    // Mount to new container
    terminalInstances.mountTerminalInstance(tabId, container)

    // Fit to new container size
    try {
      const { cols, rows } = instance.terminal
      instance.terminal.resize(cols, rows)
      instance.terminal.scrollToBottom()
      state.resizePty({ tabId, cols, rows })
    } catch (e) {
      console.error('[terminal] Remount fit error:', e)
    }

  },
  
  unmountTerminal: (tabId: string) => {
    const state = get()

    // Dispose terminal instance using the service
    terminalInstances.disposeTerminalInstance(tabId)

    // Remove PTY subscriber
    const { [tabId]: _, ...restSubs } = state.ptySubscribers
    set({ ptySubscribers: restSubs })

  },
  
  fitTerminal: (tabId: string) => {
    const state = get()
    const instance = terminalInstances.getTerminalInstance(tabId)
    if (!instance || !instance.container) return

    try {
      // Get current terminal dimensions
      const oldCols = instance.terminal.cols
      const oldRows = instance.terminal.rows

      // Fit the terminal using the service
      terminalInstances.fitTerminalInstance(tabId)

      const { cols, rows } = instance.terminal

      // Force xterm to update its renderer
      instance.terminal.resize(cols, rows)

      // Scroll to bottom to ensure we're showing the latest content
      instance.terminal.scrollToBottom()

      // Only resize PTY if dimensions actually changed
      if (cols !== oldCols || rows !== oldRows) {
        state.resizePty({ tabId, cols, rows })
      }
    } catch (e) {
      console.error('[terminal] Fit error:', e)
    }
  },
  
  fitAllTerminals: (context: 'agent' | 'explorer') => {
    const state = get()
    const tabs = context === 'agent' ? state.agentTerminalTabs : state.explorerTerminalTabs
    tabs.forEach((tabId) => {
      state.fitTerminal(tabId)
    })
  },
  
  // PTY Actions
  ensurePtyInfra: () => {
    const state = get()
    if (state.ptyInitialized) return
    
    // Global PTY event routing
    try {
      ptySvc.onData(({ sessionId, data }: { sessionId: string; data: string }) => {
        let tabId = get().ptyBySessionId[sessionId]

        // Failsafe: if no mapping yet, bind to active agent terminal on first data chunk
        if (!tabId) {
          const activeAgent = get().agentActiveTerminal
          if (activeAgent) {
            set({ ptyBySessionId: { ...get().ptyBySessionId, [sessionId]: activeAgent } })
            tabId = activeAgent
          }
        }

        const sub = tabId ? get().ptySubscribers[tabId] : undefined
        if (sub) sub(data)
      })

      ptySvc.onExit(({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
        const tabId = get().ptyBySessionId[sessionId]
        const ptySession = tabId ? get().ptySessions[tabId] : undefined
        const sub = tabId ? get().ptySubscribers[tabId] : undefined

        if (sub) sub(`\r\n[process exited with code ${exitCode}]\r\n`)

        // Cleanup mappings but keep subscriber until component unmounts
        if (tabId) {
          const { [tabId]: _, ...rest } = get().ptySessions
          set({ ptySessions: rest })
        }

        const { [sessionId]: __, ...restIdx } = get().ptyBySessionId
        set({ ptyBySessionId: restIdx })

        // Auto-restart agent terminals (session-bound terminals)
        if (ptySession?.context === 'agent' && tabId) {
          console.log('[terminal] Agent terminal exited, restarting...', { tabId, sessionId, exitCode })

          // Restart the PTY session after a short delay
          setTimeout(async () => {
            try {
              const state = get() as any
              const instance = terminalInstances.getTerminalInstance(tabId)

              if (instance && state.agentTerminalTabs.includes(tabId)) {
                // Re-create PTY session for this terminal
                await state.ensurePtySession({
                  tabId,
                  opts: {
                    cols: instance.terminal.cols,
                    rows: instance.terminal.rows,
                    context: 'agent'
                  }
                })

                if (sub) sub(`\r\n[terminal restarted]\r\n`)
                console.log('[terminal] Agent terminal restarted successfully:', tabId)
              }
            } catch (err) {
              console.error('[terminal] Failed to restart agent terminal:', err)
              if (sub) sub(`\r\n[failed to restart terminal: ${err}]\r\n`)
            }
          }, 1000)
        }
      })
    } catch {}
    
    set({ ptyInitialized: true })
  },
  
  ensurePtySession: async ({ tabId, opts }: { tabId: string; opts?: { cwd?: string; shell?: string; cols?: number; rows?: number; context?: 'agent' | 'explorer' } }) => {
    const state = get() as any
    state.ensurePtyInfra()
    
    const cols = opts?.cols ?? DEFAULTS.TERMINAL_COLS
    const rows = opts?.rows ?? DEFAULTS.TERMINAL_ROWS
    const context = opts?.context ?? 'explorer'
    
    try {
      // Agent terminals need to bind to the session's PTY session
      if (context === 'agent') {
        // Use session ID as requestId so terminal binds to the session's PTY
        const requestId = state.currentId || 'agent'
        const attach = await ptySvc.attachAgent({ requestId, tailBytes: 400 })
        
        if (!attach?.sessionId) {
          console.error('[terminal] attachAgent returned no sessionId:', attach)
          throw new Error('PTY attach failed: no sessionId returned')
        }
        
        const desiredSessionId = attach.sessionId
        const existing = state.ptySessions[tabId]
        
        if (existing && existing.sessionId === desiredSessionId) {
          return { sessionId: existing.sessionId }
        }
        
        // If an old agent session is wired, detach and rewire to the active one
        if (existing) {
          try {
            await ptySvc.detachAgent(existing.sessionId)
          } catch {}
          
          const { [existing.sessionId]: __, ...restIdx } = get().ptyBySessionId
          set({ ptyBySessionId: restIdx })
        }
        
        const rec: PtySession = {
          tabId,
          sessionId: desiredSessionId,
          cols,
          rows,
          cwd: opts?.cwd,
          shell: opts?.shell,
          context,
        }
        
        set({
          ptySessions: { ...get().ptySessions, [tabId]: rec },
          ptyBySessionId: { ...get().ptyBySessionId, [desiredSessionId]: tabId },
        })
        
        return { sessionId: desiredSessionId }
      }
      
      // Non-agent (explorer) terminals create their own PTY
      const create = await ptySvc.create({
        cwd: opts?.cwd ?? state.workspaceRoot ?? undefined,
        shell: opts?.shell,
        cols,
        rows,
      })
      
      if (!create?.sessionId) {
        console.error('[terminal] create returned no sessionId:', create)
        throw new Error('PTY create failed: no sessionId returned')
      }
      
      const sessionId = create.sessionId
      const rec: PtySession = {
        tabId,
        sessionId,
        cols,
        rows,
        cwd: opts?.cwd,
        shell: opts?.shell,
        context,
      }
      
      set({
        ptySessions: { ...get().ptySessions, [tabId]: rec },
        ptyBySessionId: { ...get().ptyBySessionId, [sessionId]: tabId },
      })
      
      return { sessionId }
    } catch (e: any) {
      console.error('[terminal] Failed to ensure session for', tabId, ':', e)
      throw e
    }
  },
  
  writePty: async ({ tabId, data }: { tabId: string; data: string }) => {
    const rec = get().ptySessions[tabId]
    if (!rec) {
      return { ok: false }
    }
    
    try {
      return await ptySvc.write(rec.sessionId, data)
    } catch (e: any) {
      console.error('[terminal] writePty failed for', tabId, ':', e)
      return { ok: false }
    }
  },
  
  resizePty: async ({ tabId, cols, rows }: { tabId: string; cols: number; rows: number }) => {
    const rec = get().ptySessions[tabId]
    if (!rec) return { ok: false }
    
    try {
      return await ptySvc.resize(rec.sessionId, cols, rows)
    } catch {
      return { ok: false }
    }
  },
  
  disposePty: async (tabId: string) => {
    const rec = get().ptySessions[tabId]
    if (!rec) return { ok: true }
    
    try {
      if (rec.context === 'agent') {
        await ptySvc.detachAgent(rec.sessionId)
      } else {
        await ptySvc.dispose(rec.sessionId)
      }
    } catch {}
    
    const { [tabId]: _, ...rest } = get().ptySessions
    const { [rec.sessionId]: __, ...restIdx } = get().ptyBySessionId
    set({ ptySessions: rest, ptyBySessionId: restIdx })
    
    return { ok: true }
  },
  
  subscribePtyData: ({ tabId, fn }: { tabId: string; fn: (data: string) => void }) => {
    set({ ptySubscribers: { ...get().ptySubscribers, [tabId]: fn } })
    
    return () => {
      const map = { ...get().ptySubscribers }
      delete map[tabId]
      set({ ptySubscribers: map })
    }
  },
})

