/**
 * Terminal Service
 * 
 * Manages terminal tabs, instances, and PTY sessions.
 */

import { Service } from './base/Service.js'
import type { PtySession } from '../store/types.js'
import * as ptySvc from '../services/pty.js'
import * as terminalInstances from '../services/terminalInstances.js'
import * as agentPty from '../services/agentPty.js'
import { DEFAULTS } from '../store/utils/constants.js'
import { ServiceRegistry } from './base/ServiceRegistry.js'

interface TerminalState {
  agentTerminalTabs: string[]
  agentActiveTerminal: string | null
  explorerTerminalTabs: string[]
  explorerActiveTerminal: string | null
  agentSessionTerminals: Record<string, string[]>
  ptyInitialized: boolean
  ptySessions: Record<string, PtySession>
  ptyBySessionId: Record<string, string>
  ptySubscribers: Record<string, ((data: string) => void) | undefined>
}

export class TerminalService extends Service<TerminalState> {
  constructor() {
    super({
      agentTerminalTabs: [],
      agentActiveTerminal: null,
      explorerTerminalTabs: [],
      explorerActiveTerminal: null,
      agentSessionTerminals: {},
      ptyInitialized: false,
      ptySessions: {},
      ptyBySessionId: {},
      ptySubscribers: {},
    })

    // Listen to session events to manage PTY lifecycle
    this.setupSessionEventListeners()
  }

  protected onStateChange(updates: Partial<TerminalState>): void {
    // Terminal state is transient, no persistence needed

    // Emit events when terminal tabs change
    if (
      updates.agentTerminalTabs !== undefined ||
      updates.agentActiveTerminal !== undefined ||
      updates.explorerTerminalTabs !== undefined ||
      updates.explorerActiveTerminal !== undefined
    ) {
      this.events.emit('terminal:tabs:changed', {
        agentTabs: this.state.agentTerminalTabs,
        agentActive: this.state.agentActiveTerminal,
        explorerTabs: this.state.explorerTerminalTabs,
        explorerActive: this.state.explorerActiveTerminal,
      })
    }
  }

  /**
   * Setup event listeners for session lifecycle events
   */
  private setupSessionEventListeners(): void {
    // Wait for SessionService to be initialized
    setTimeout(() => {
      const sessionService = ServiceRegistry.get<any>('session')
      if (!sessionService) {
        console.warn('[Terminal] SessionService not available for event listeners')
        return
      }

      // Listen for session creation
      sessionService.on('session:created', async (data: { workspaceId: string; sessionId: string }) => {
        console.log('[Terminal] Session created, ensuring PTY:', data.sessionId)
        try {
          await agentPty.ensurePtyForSession(data.sessionId)
          console.log('[Terminal] PTY created for session:', data.sessionId)
        } catch (error) {
          console.error('[Terminal] Failed to create PTY for session:', error)
        }
      })

      // Listen for session selection
      sessionService.on(
        'session:selected',
        async (data: { workspaceId: string; sessionId: string; previousSessionId: string | null }) => {
          console.log('[Terminal] Session selected, ensuring PTY:', data.sessionId)
          try {
            await agentPty.ensurePtyForSession(data.sessionId)
            console.log('[Terminal] PTY ensured for session:', data.sessionId)
          } catch (error) {
            console.error('[Terminal] Failed to ensure PTY for session:', error)
          }
        }
      )

      // Listen for session deletion
      sessionService.on('session:deleted', (data: { workspaceId: string; sessionId: string }) => {
        console.log('[Terminal] Session deleted, cleaning up PTY:', data.sessionId)
        // PTY cleanup is handled by agentPty module
        // We could add explicit cleanup here if needed
      })
    }, 100) // Small delay to ensure SessionService is registered
  }

  // Getters
  getAgentTerminalTabs(): string[] {
    return this.state.agentTerminalTabs
  }

  getAgentActiveTerminal(): string | null {
    return this.state.agentActiveTerminal
  }

  getExplorerTerminalTabs(): string[] {
    return this.state.explorerTerminalTabs
  }

  getExplorerActiveTerminal(): string | null {
    return this.state.explorerActiveTerminal
  }

  getPtySessions(): Record<string, PtySession> {
    return this.state.ptySessions
  }

  getPtyBySessionId(): Record<string, string> {
    return this.state.ptyBySessionId
  }

  // Terminal Tab Actions
  addTerminalTab(context: 'agent' | 'explorer'): string {
    const prefix = context === 'agent' ? 'a' : 'e'
    const tabId = `${prefix}${crypto.randomUUID().slice(0, 7)}`

    if (context === 'agent') {
      this.setState({
        agentTerminalTabs: [...this.state.agentTerminalTabs, tabId],
        agentActiveTerminal: tabId,
      })
    } else {
      this.setState({
        explorerTerminalTabs: [...this.state.explorerTerminalTabs, tabId],
        explorerActiveTerminal: tabId,
      })
    }

    return tabId
  }

  removeTerminalTab(params: { context: 'agent' | 'explorer'; tabId: string }): void {
    const { context, tabId } = params

    // Unmount and dispose
    this.unmountTerminal(tabId)
    this.disposePty(tabId)

    if (context === 'agent') {
      const tabs = this.state.agentTerminalTabs.filter((id) => id !== tabId)
      const active = this.state.agentActiveTerminal === tabId ? tabs[0] || null : this.state.agentActiveTerminal
      this.setState({ agentTerminalTabs: tabs, agentActiveTerminal: active })
    } else {
      const tabs = this.state.explorerTerminalTabs.filter((id) => id !== tabId)
      const active =
        this.state.explorerActiveTerminal === tabId ? tabs[0] || null : this.state.explorerActiveTerminal
      this.setState({ explorerTerminalTabs: tabs, explorerActiveTerminal: active })
    }
  }

  setActiveTerminal(params: { context: 'agent' | 'explorer'; tabId: string | null }): void {
    const { context, tabId } = params
    if (context === 'agent') {
      this.setState({ agentActiveTerminal: tabId })
    } else {
      this.setState({ explorerActiveTerminal: tabId })
    }
  }

  async clearAgentTerminals(): Promise<void> {
    // Unmount and dispose all agent terminals
    await Promise.all(
      this.state.agentTerminalTabs.map((tabId) => {
        this.unmountTerminal(tabId)
        return this.disposePty(tabId)
      })
    )

    // Clear agent terminal state
    this.setState({ agentTerminalTabs: [], agentActiveTerminal: null })

    // Enforce at least one agent terminal after clearing
    const newId = `a${crypto.randomUUID().slice(0, 7)}`
    this.setState({ agentTerminalTabs: [newId], agentActiveTerminal: newId })
  }

  async clearExplorerTerminals(): Promise<void> {
    // Unmount and dispose all explorer terminals
    await Promise.all(
      this.state.explorerTerminalTabs.map((tabId) => {
        this.unmountTerminal(tabId)
        return this.disposePty(tabId)
      })
    )

    // Clear explorer terminal state
    this.setState({ explorerTerminalTabs: [], explorerActiveTerminal: null })
  }

  async ensureSessionTerminal(): Promise<void> {
    const sessionService = ServiceRegistry.get<any>('session')
    const currentSessionId = sessionService?.getCurrentId()

    console.log('[terminal] ensureSessionTerminal called:', { currentSessionId, hasCurrentId: !!currentSessionId })

    if (!currentSessionId) {
      console.warn('[terminal] ensureSessionTerminal: no current session')
      return
    }

    // Check if we already have a terminal for this session
    const existingTabs = this.state.agentTerminalTabs || []

    if (existingTabs.length === 0) {
      // No terminals exist - create one
      const tabId = `a${crypto.randomUUID().slice(0, 7)}`
      this.setState({
        agentTerminalTabs: [tabId],
        agentActiveTerminal: tabId,
      })
      console.log('[terminal] Created session terminal:', tabId, 'for session:', currentSessionId)
    } else {
      // Terminal already exists - ensure it's active
      if (!this.state.agentActiveTerminal) {
        this.setState({ agentActiveTerminal: existingTabs[0] })
      }
      console.log('[terminal] Session terminal already exists:', existingTabs[0], 'for session:', currentSessionId)
    }
  }

  // Terminal Instance Actions
  async mountTerminal(params: {
    tabId: string
    container: HTMLElement
    context: 'agent' | 'explorer'
  }): Promise<void> {
    const { tabId, container, context } = params

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
      await this.ensurePtySession({ tabId, opts: { cols, rows, context } })

      // Subscribe to PTY data and write to terminal
      this.subscribePtyData({
        tabId,
        fn: (data: string) => {
          try {
            instance.terminal.write(data)
          } catch {}
        },
      })

      // Route terminal input to PTY (if not disabled)
      if (context !== 'agent') {
        instance.terminal.onData((data: string) => this.writePty({ tabId, data }))
      }
    } catch (err: any) {
      instance.terminal.writeln(`\r\n[PTY Error: ${err?.message || String(err)}]`)
    }
  }

  remountTerminal(params: { tabId: string; container: HTMLElement }): void {
    const { tabId, container } = params
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
      this.resizePty({ tabId, cols, rows })
    } catch (e) {
      console.error('[terminal] Remount fit error:', e)
    }
  }

  unmountTerminal(tabId: string): void {
    // Dispose terminal instance using the service
    terminalInstances.disposeTerminalInstance(tabId)

    // Remove PTY subscriber
    const { [tabId]: _, ...restSubs } = this.state.ptySubscribers
    this.setState({ ptySubscribers: restSubs })
  }

  fitTerminal(tabId: string): void {
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
        this.resizePty({ tabId, cols, rows })
      }
    } catch (e) {
      console.error('[terminal] Fit error:', e)
    }
  }

  fitAllTerminals(context: 'agent' | 'explorer'): void {
    const tabs = context === 'agent' ? this.state.agentTerminalTabs : this.state.explorerTerminalTabs
    tabs.forEach((tabId) => {
      this.fitTerminal(tabId)
    })
  }

  // PTY Actions
  ensurePtyInfra(): void {
    if (this.state.ptyInitialized) return

    // Global PTY event routing
    try {
      ptySvc.onData(({ sessionId, data }: { sessionId: string; data: string }) => {
        let tabId = this.state.ptyBySessionId[sessionId]

        // Failsafe: if no mapping yet, bind to active agent terminal on first data chunk
        if (!tabId) {
          const activeAgent = this.state.agentActiveTerminal
          if (activeAgent) {
            this.setState({ ptyBySessionId: { ...this.state.ptyBySessionId, [sessionId]: activeAgent } })
            tabId = activeAgent
          }
        }

        const sub = tabId ? this.state.ptySubscribers[tabId] : undefined
        if (sub) sub(data)
      })

      ptySvc.onExit(({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
        const tabId = this.state.ptyBySessionId[sessionId]
        const ptySession = tabId ? this.state.ptySessions[tabId] : undefined
        const sub = tabId ? this.state.ptySubscribers[tabId] : undefined

        if (sub) sub(`\r\n[process exited with code ${exitCode}]\r\n`)

        // Cleanup mappings but keep subscriber until component unmounts
        if (tabId) {
          const { [tabId]: _, ...rest } = this.state.ptySessions
          this.setState({ ptySessions: rest })
        }

        const { [sessionId]: __, ...restIdx } = this.state.ptyBySessionId
        this.setState({ ptyBySessionId: restIdx })

        // Auto-restart agent terminals (session-bound terminals)
        if (ptySession?.context === 'agent' && tabId) {
          console.log('[terminal] Agent terminal exited, restarting...', { tabId, sessionId, exitCode })

          // Restart the PTY session after a short delay
          setTimeout(async () => {
            try {
              const instance = terminalInstances.getTerminalInstance(tabId)

              if (instance && this.state.agentTerminalTabs.includes(tabId)) {
                // Re-create PTY session for this terminal
                await this.ensurePtySession({
                  tabId,
                  opts: {
                    cols: instance.terminal.cols,
                    rows: instance.terminal.rows,
                    context: 'agent',
                  },
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

    this.setState({ ptyInitialized: true })
  }

  async ensurePtySession(params: {
    tabId: string
    opts?: { cwd?: string; shell?: string; cols?: number; rows?: number; context?: 'agent' | 'explorer' }
  }): Promise<{ sessionId: string }> {
    const { tabId, opts } = params
    this.ensurePtyInfra()

    const cols = opts?.cols ?? DEFAULTS.TERMINAL_COLS
    const rows = opts?.rows ?? DEFAULTS.TERMINAL_ROWS
    const context = opts?.context ?? 'explorer'

    try {
      // Agent terminals need to bind to the session's PTY session
      if (context === 'agent') {
        // Use session ID as requestId so terminal binds to the session's PTY
        const sessionService = ServiceRegistry.get<any>('session')
        const requestId = sessionService?.getCurrentId() || 'agent'
        const attach = await ptySvc.attachAgent({ requestId, tailBytes: 400 })

        if (!attach?.sessionId) {
          console.error('[terminal] attachAgent returned no sessionId:', attach)
          throw new Error('PTY attach failed: no sessionId returned')
        }

        const desiredSessionId = attach.sessionId
        const existing = this.state.ptySessions[tabId]

        if (existing && existing.sessionId === desiredSessionId) {
          return { sessionId: existing.sessionId }
        }

        // If an old agent session is wired, detach and rewire to the active one
        if (existing) {
          try {
            await ptySvc.detachAgent(existing.sessionId)
          } catch {}

          const { [existing.sessionId]: __, ...restIdx } = this.state.ptyBySessionId
          this.setState({ ptyBySessionId: restIdx })
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

        this.setState({
          ptySessions: { ...this.state.ptySessions, [tabId]: rec },
          ptyBySessionId: { ...this.state.ptyBySessionId, [desiredSessionId]: tabId },
        })

        return { sessionId: desiredSessionId }
      }

      // Non-agent (explorer) terminals create their own PTY
      const workspaceService = ServiceRegistry.get<any>('workspace')
      const create = await ptySvc.create({
        cwd: opts?.cwd ?? workspaceService?.getWorkspaceRoot() ?? undefined,
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

      this.setState({
        ptySessions: { ...this.state.ptySessions, [tabId]: rec },
        ptyBySessionId: { ...this.state.ptyBySessionId, [sessionId]: tabId },
      })

      return { sessionId }
    } catch (e: any) {
      console.error('[terminal] Failed to ensure session for', tabId, ':', e)
      throw e
    }
  }

  async writePty(params: { tabId: string; data: string }): Promise<{ ok: boolean }> {
    const { tabId, data } = params
    const rec = this.state.ptySessions[tabId]
    if (!rec) {
      return { ok: false }
    }

    try {
      return await ptySvc.write(rec.sessionId, data)
    } catch (e: any) {
      console.error('[terminal] writePty failed for', tabId, ':', e)
      return { ok: false }
    }
  }

  async resizePty(params: { tabId: string; cols: number; rows: number }): Promise<{ ok: boolean }> {
    const { tabId, cols, rows } = params
    const rec = this.state.ptySessions[tabId]
    if (!rec) return { ok: false }

    try {
      return await ptySvc.resize(rec.sessionId, cols, rows)
    } catch {
      return { ok: false }
    }
  }

  async disposePty(tabId: string): Promise<{ ok: boolean }> {
    const rec = this.state.ptySessions[tabId]
    if (!rec) return { ok: true }

    try {
      if (rec.context === 'agent') {
        await ptySvc.detachAgent(rec.sessionId)
      } else {
        await ptySvc.dispose(rec.sessionId)
      }
    } catch {}

    const { [tabId]: _, ...rest } = this.state.ptySessions
    const { [rec.sessionId]: __, ...restIdx } = this.state.ptyBySessionId
    this.setState({ ptySessions: rest, ptyBySessionId: restIdx })

    return { ok: true }
  }

  subscribePtyData(params: { tabId: string; fn: (data: string) => void }): () => void {
    const { tabId, fn } = params
    this.setState({ ptySubscribers: { ...this.state.ptySubscribers, [tabId]: fn } })

    return () => {
      const map = { ...this.state.ptySubscribers }
      delete map[tabId]
      this.setState({ ptySubscribers: map })
    }
  }
}

