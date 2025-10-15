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
import type { PtySession, TerminalInstance } from '../types'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import * as ptySvc from '../../services/pty'
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
  
  // Terminal Instances State
  terminals: Record<string, TerminalInstance>
  
  // PTY State
  ptyInitialized: boolean
  ptySessions: Record<string, PtySession>
  ptyBySessionId: Record<string, string>
  ptySubscribers: Record<string, ((data: string) => void) | undefined>
  
  // Terminal Tab Actions
  addTerminalTab: (context: 'agent' | 'explorer') => string
  removeTerminalTab: (context: 'agent' | 'explorer', tabId: string) => void
  setActiveTerminal: (context: 'agent' | 'explorer', tabId: string | null) => void
  clearAgentTerminals: () => Promise<void>
  clearExplorerTerminals: () => Promise<void>
  
  // Terminal Instance Actions
  mountTerminal: (tabId: string, container: HTMLElement, context: 'agent' | 'explorer') => Promise<void>
  remountTerminal: (tabId: string, container: HTMLElement) => void
  unmountTerminal: (tabId: string) => void
  fitTerminal: (tabId: string) => void
  fitAllTerminals: (context: 'agent' | 'explorer') => void
  
  // PTY Actions
  ensurePtyInfra: () => void
  ensurePtySession: (tabId: string, opts?: { cwd?: string; shell?: string; cols?: number; rows?: number; context?: 'agent' | 'explorer' }) => Promise<{ sessionId: string }>
  writePty: (tabId: string, data: string) => Promise<{ ok: boolean }>
  resizePty: (tabId: string, cols: number, rows: number) => Promise<{ ok: boolean }>
  disposePty: (tabId: string) => Promise<{ ok: boolean }>
  subscribePtyData: (tabId: string, fn: (data: string) => void) => () => void
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
  
  terminals: {},
  
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
    
    console.debug('[terminal] Added', context, 'terminal:', tabId)
    return tabId
  },
  
  removeTerminalTab: (context: 'agent' | 'explorer', tabId: string) => {
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
    
    console.debug('[terminal] Removed', context, 'terminal:', tabId)
  },
  
  setActiveTerminal: (context: 'agent' | 'explorer', tabId: string | null) => {
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
    
    console.debug('[terminal] Cleared agent terminals, created new:', newId)
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
    
    console.debug('[terminal] Cleared explorer terminals')
  },
  
  // Terminal Instance Actions
  mountTerminal: async (tabId: string, container: HTMLElement, context: 'agent' | 'explorer') => {
    const state = get()
    
    // Create terminal instance
    const terminal = new Terminal({
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      disableStdin: context === 'agent',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    })
    
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    
    // Open terminal in container
    terminal.open(container)
    
    // Wait for fonts to load
    try {
      await (document as any).fonts?.ready
    } catch {}
    
    // Initial fit
    try {
      fitAddon.fit()
    } catch (e) {
      console.error('[terminal] Initial fit error:', e)
    }
    
    // Create PTY session
    const cols = terminal.cols
    const rows = terminal.rows
    
    try {
      await state.ensurePtySession(tabId, { cols, rows, context })
      
      // Subscribe to PTY data and write to terminal
      state.subscribePtyData(tabId, (data) => {
        try {
          terminal.write(data)
        } catch {}
      })
      
      // Route terminal input to PTY (if not disabled)
      if (context !== 'agent') {
        terminal.onData((data) => state.writePty(tabId, data))
      }
    } catch (err: any) {
      terminal.writeln(`\r\n[PTY Error: ${err?.message || String(err)}]`)
    }
    
    // Setup resize observer
    const resizeObserver = new ResizeObserver(() => {
      const instance = get().terminals[tabId]
      if (instance?.resizeTimeout) {
        clearTimeout(instance.resizeTimeout)
      }
      
      // Use requestAnimationFrame to ensure layout is complete before fitting
      const timeout = setTimeout(() => {
        requestAnimationFrame(() => {
          get().fitTerminal(tabId)
        })
      }, 10)
      
      // Update the stored timeout
      const current = get().terminals[tabId]
      if (current) {
        set({
          terminals: {
            ...get().terminals,
            [tabId]: { ...current, resizeTimeout: timeout },
          },
        })
      }
    })
    
    resizeObserver.observe(container)
    
    // Also observe parent to catch panel resize
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement)
    }
    
    // Store terminal instance
    set({
      terminals: {
        ...state.terminals,
        [tabId]: { terminal, fitAddon, container, resizeObserver, resizeTimeout: null },
      },
    })
    
    console.debug('[terminal] Mounted terminal:', tabId, context)
  },
  
  remountTerminal: (tabId: string, container: HTMLElement) => {
    const state = get()
    const instance = state.terminals[tabId]
    if (!instance) return
    
    // Disconnect old observer if it exists
    if (instance.resizeObserver) {
      instance.resizeObserver.disconnect()
    }
    
    // Update container reference
    instance.container = container
    
    // Reopen terminal in new container
    instance.terminal.open(container)
    
    // Fit to new container size
    try {
      instance.fitAddon.fit()
      const { cols, rows } = instance.terminal
      instance.terminal.resize(cols, rows)
      instance.terminal.scrollToBottom()
      state.resizePty(tabId, cols, rows)
    } catch (e) {
      console.error('[terminal] Remount fit error:', e)
    }
    
    // Setup new resize observer
    const resizeObserver = new ResizeObserver(() => {
      const inst = get().terminals[tabId]
      if (inst?.resizeTimeout) {
        clearTimeout(inst.resizeTimeout)
      }
      
      const timeout = setTimeout(() => {
        requestAnimationFrame(() => {
          get().fitTerminal(tabId)
        })
      }, 10)
      
      const current = get().terminals[tabId]
      if (current) {
        set({
          terminals: {
            ...get().terminals,
            [tabId]: { ...current, resizeTimeout: timeout },
          },
        })
      }
    })
    
    resizeObserver.observe(container)
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement)
    }
    
    // Update instance with new observer
    set({
      terminals: {
        ...state.terminals,
        [tabId]: { ...instance, container, resizeObserver },
      },
    })
    
    console.debug('[terminal] Remounted terminal:', tabId)
  },
  
  unmountTerminal: (tabId: string) => {
    const state = get()
    const instance = state.terminals[tabId]
    if (!instance) return
    
    // Cleanup
    if (instance.resizeTimeout) clearTimeout(instance.resizeTimeout)
    if (instance.resizeObserver) instance.resizeObserver.disconnect()
    instance.terminal.dispose()
    
    // Remove PTY subscriber
    const { [tabId]: _, ...restSubs } = state.ptySubscribers
    
    // Remove from state
    const { [tabId]: __, ...rest } = state.terminals
    set({ terminals: rest, ptySubscribers: restSubs })
    
    console.debug('[terminal] Unmounted terminal:', tabId)
  },
  
  fitTerminal: (tabId: string) => {
    const state = get()
    const instance = state.terminals[tabId]
    if (!instance || !instance.container) return
    
    try {
      // Get current terminal dimensions
      const oldCols = instance.terminal.cols
      const oldRows = instance.terminal.rows
      
      // Fit the terminal - this calculates and applies new dimensions
      instance.fitAddon.fit()
      
      const { cols, rows } = instance.terminal
      
      // Force xterm to update its renderer
      instance.terminal.resize(cols, rows)
      
      // Scroll to bottom to ensure we're showing the latest content
      instance.terminal.scrollToBottom()
      
      // Only resize PTY if dimensions actually changed
      if (cols !== oldCols || rows !== oldRows) {
        state.resizePty(tabId, cols, rows)
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
      ptySvc.onData(({ sessionId, data }) => {
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
      
      ptySvc.onExit(({ sessionId, exitCode }) => {
        const tabId = get().ptyBySessionId[sessionId]
        const sub = tabId ? get().ptySubscribers[tabId] : undefined
        if (sub) sub(`\r\n[process exited with code ${exitCode}]\r\n`)
        
        // Cleanup mappings but keep subscriber until component unmounts
        if (tabId) {
          const { [tabId]: _, ...rest } = get().ptySessions
          set({ ptySessions: rest })
        }
        
        const { [sessionId]: __, ...restIdx } = get().ptyBySessionId
        set({ ptyBySessionId: restIdx })
      })
    } catch {}
    
    set({ ptyInitialized: true })
    console.debug('[terminal] PTY infrastructure initialized')
  },
  
  ensurePtySession: async (tabId: string, opts) => {
    const state = get() as any
    state.ensurePtyInfra()
    
    const cols = opts?.cols ?? DEFAULTS.TERMINAL_COLS
    const rows = opts?.rows ?? DEFAULTS.TERMINAL_ROWS
    const context = opts?.context ?? 'explorer'
    
    try {
      // Agent terminals need to bind to the ACTIVE request's PTY session
      if (context === 'agent') {
        const requestId = state.currentRequestId || 'agent'
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
  
  writePty: async (tabId: string, data: string) => {
    const rec = get().ptySessions[tabId]
    if (!rec) {
      console.warn('[terminal] writePty: no session for tabId', tabId)
      return { ok: false }
    }
    
    try {
      return await ptySvc.write(rec.sessionId, data)
    } catch (e: any) {
      console.error('[terminal] writePty failed for', tabId, ':', e)
      return { ok: false }
    }
  },
  
  resizePty: async (tabId: string, cols: number, rows: number) => {
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
  
  subscribePtyData: (tabId: string, fn: (data: string) => void) => {
    set({ ptySubscribers: { ...get().ptySubscribers, [tabId]: fn } })
    
    return () => {
      const map = { ...get().ptySubscribers }
      delete map[tabId]
      set({ ptySubscribers: map })
    }
  },
})

