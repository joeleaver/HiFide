import { randomBytes } from 'node:crypto'
import { createServer, Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { JSONRPCServer, JSONRPCServerAndClient, JSONRPCClient } from 'json-rpc-2.0'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow } from 'electron'

import { redactOutput } from '../../utils/security'
import { registerConnection, unregisterConnection, setConnectionWorkspace, setConnectionWindowId, getConnectionWorkspaceId, broadcastWorkspaceNotification, activeConnections, setConnectionSelectedSessionId, transitionConnectionPhase, type RpcConnection } from './broadcast'
import { sendWorkspaceSnapshot } from './snapshot'
import * as agentPty from '../../services/agentPty'
import { flowEvents } from '../../ipc/flows-v2/events'

import { useMainStore } from '../../store/index'
import { sessionSaver } from '../../store/utils/session-persistence'
import { UiPayloadCache } from '../../core/uiPayloadCache'
import { getWorkspaceIdForSessionId } from '../../utils/workspace-session'

import { readById, normalizeMarkdown, extractTrailingMeta } from '../../store/utils/knowledgeBase'
import { deriveTitle as deriveSessionTitle, initialSessionTitle as initialSessionTitleUtil } from '../../store/utils/sessions'
import { listItems, createItem, updateItem, deleteItem } from '../../store/utils/knowledgeBase'
import { listWorkspaceFiles } from '../../store/utils/workspace-helpers'
import { getKbIndexer, getIndexer } from '../../core/state'



const require = createRequire(import.meta.url)

function broadcastFlowEvent(ev: any): void {
  try {
    const sid = (ev && typeof ev === 'object') ? (ev.sessionId || null) : null
    const wsFromSid = getWorkspaceIdForSessionId(sid)
    const fallback = (useMainStore.getState() as any).workspaceRoot || null
    const target = wsFromSid || fallback
    if (target) {
      broadcastWorkspaceNotification(target, 'flow.event', ev)
    }
  } catch {}
}

export interface WsBootstrap {
  url: string
  token: string
}

// Global flow.event forwarder: ensure renderers receive flow events regardless of when executeFlow was called
// We attach once and forward all request-scoped events emitted by the scheduler
try {
  const forwardedRequestIds = new Set<string>()
  // Legacy per-request wiring (kept for compatibility if other subsystems add listeners)
  flowEvents.on('newListener', (eventName: string) => {
    // Ignore internal EventEmitter events
    if (eventName === 'newListener' || eventName === 'removeListener') return
    if (typeof eventName !== 'string') return
    if (forwardedRequestIds.has(eventName)) return

    const listener = (event: any) => {
      try {
        const sanitized = JSON.parse(JSON.stringify(event))
        const payload = { requestId: eventName, ...sanitized }
        broadcastFlowEvent(payload)
      } catch (error) {
        try {
          broadcastFlowEvent({
            requestId: eventName,
            type: 'error',
            error: 'Failed to serialize flow event'
          })
        } catch {}
      }
    }

    forwardedRequestIds.add(eventName)
    flowEvents.on(eventName, listener)

    // When all listeners for a requestId are removed (e.g., after cancel/done),

  // New: listen to broadcast channel from flowEvents so we always forward events
  try {
    flowEvents.on('broadcast', (event: any) => {
      try {
        const sanitized = JSON.parse(JSON.stringify(event))
        broadcastFlowEvent(sanitized)
      } catch (error) {
        try {
          const reqId = (event && typeof event === 'object' ? (event.requestId || 'unknown') : 'unknown')
          broadcastFlowEvent({
            requestId: reqId,
            type: 'error',
            error: 'Failed to serialize flow event'
          })
        } catch {}
      }
    })
  } catch {}
    // allow forwarder re-attachment on the next start with the same requestId
    flowEvents.on('removeListener', (removedEvent: string) => {
      if (removedEvent === 'newListener' || removedEvent === 'removeListener') return
      if (typeof removedEvent !== 'string') return
      try {
        if (flowEvents.listenerCount(removedEvent) === 0) {
          forwardedRequestIds.delete(removedEvent)
        }
      } catch {}
    })

  })
} catch {}

// Minimal PTY interface
type IPty = {
  onData: (cb: (data: string) => void) => void
  resize: (cols: number, rows: number) => void
  write: (data: string) => void
  kill: () => void
  pid: number
  onExit: (cb: (ev: { exitCode: number }) => void) => void
}

// Per-connection terminal registries
function createTerminalService(addMethod: (method: string, handler: (params: any) => any) => void, connection: RpcConnection) {
  const ptySessions = new Map<string, { p: IPty }>()

  function loadPtyModule(): any | null {
    try {
      const mod = require('node-pty')
      return mod
    } catch (e) {
      return null
    }
  }

  addMethod('terminal.create', async (opts: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean } = {}) => {
    const isWin = process.platform === 'win32'
    const shell = opts.shell || (isWin ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : (process.env.SHELL || '/bin/bash'))
    const cols = opts.cols || 80
    const rows = opts.rows || 24
    const env = { ...process.env, ...(opts.env || {}) }
    const boundCwd = getConnectionWorkspaceId(connection)
const cwd = opts.cwd || boundCwd || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()

    const ptyModule = loadPtyModule()
    if (!ptyModule) throw new Error('pty-unavailable')

    const p: IPty = (ptyModule as any).spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env })
    const sessionId = randomUUID()
    ptySessions.set(sessionId, { p })

    p.onData((data: string) => {
      try {
        const { redacted } = redactOutput(data)
        connection.sendNotification('terminal.data', { sessionId, data: redacted })
      } catch {}
    })
    p.onExit(({ exitCode }: { exitCode: number }) => {
      try { connection.sendNotification('terminal.exit', { sessionId, exitCode }) } catch {}
      ptySessions.delete(sessionId)
    })

    return { sessionId }
  })

  addMethod('terminal.write', async ({ sessionId, data }: { sessionId: string; data: string }) => {
    const s = ptySessions.get(sessionId)
    if (!s) return { ok: false }
    try { s.p.write(data); return { ok: true } } catch { return { ok: false } }
  })

  addMethod('terminal.resize', async ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    const s = ptySessions.get(sessionId)
    if (s) try { s.p.resize(cols, rows) } catch {}
    return { ok: !!s }
  })

  addMethod('terminal.dispose', async ({ sessionId }: { sessionId: string }) => {
    const s = ptySessions.get(sessionId)
    if (s) {
      try { s.p.kill() } catch {}
      ptySessions.delete(sessionId)
    }
    return { ok: true }
  })

  // Agent PTY service (via shared service module)
  addMethod('agent-pty.attach', async (args: { requestId?: string; sessionId?: string; tailBytes?: number } = {}) => {
    const sid = args.sessionId || args.requestId
    if (!sid) return { ok: false, error: 'no-session' }

    // Ensure exists (create if needed)
    try { await agentPty.getOrCreateAgentPtyFor(sid) } catch (e) { return { ok: false, error: 'pty-unavailable' } }
    const rec = agentPty.getSessionRecord(sid)
    if (!rec) return { ok: false, error: 'no-session' }

    // Optionally seed with tail to this connection only
    const n = Math.max(0, Math.min(10000, args.tailBytes || 0))
    if (n > 0 && rec.state.ring && rec.state.ring.length > 0) {
      try {
        const tail = rec.state.ring.slice(-n)
        connection.sendNotification('terminal.data', { sessionId: sid, data: tail })
      } catch {}
    }
    return { ok: true, sessionId: sid }
  })

  addMethod('agent-pty.resize', async ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    return agentPty.resize(sessionId, cols, rows)
  })

  addMethod('agent-pty.write', async ({ sessionId, data }: { sessionId: string; data: string }) => {
    return agentPty.write(sessionId, data)
  })

  addMethod('agent-pty.exec', async ({ sessionId, command }: { sessionId: string; command: string }) => {
    const rec = agentPty.getSessionRecord(sessionId)
    if (!rec) return { ok: false, error: 'no-session' }
    await agentPty.beginCommand(rec.state, command)
    const isWin = process.platform === 'win32'
    const EOL = isWin ? '\r\n' : '\n'
    const ENTER = isWin ? '\r' : '\n'
    const BP_START = '\x1b[200~'
    const BP_END = '\x1b[201~'
    const cmd = String(command).replace(/\r\n?|\n/g, EOL).replace(/[\u2028\u2029]/g, EOL).trimEnd()
    const payload = isWin ? (BP_START + cmd + BP_END + ENTER) : (cmd + ENTER)
    try { rec.p.write(payload); return { ok: true } } catch { return { ok: false } }
  })

  addMethod('agent-pty.detach', async (_args: { sessionId: string }) => {
    // No-op for now; session persists until killed
    return { ok: true }
  })

  // Terminal UI state: list of tabs and active terminals
  addMethod('terminal.getTabs', async () => {
    try {
      const st: any = useMainStore.getState()
      const agentTabs = Array.isArray(st.agentTerminalTabs) ? st.agentTerminalTabs : []
      const explorerTabs = Array.isArray(st.explorerTerminalTabs) ? st.explorerTerminalTabs : []
      return {
        ok: true,
        agentTabs,
        agentActive: st.agentActiveTerminal || null,
        explorerTabs,
        explorerActive: st.explorerActiveTerminal || null,
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

	  // Terminal tab management RPCs
	  addMethod('terminal.addTab', async ({ context }: { context: 'agent' | 'explorer' }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const id = typeof st.addTerminalTab === 'function' ? st.addTerminalTab(context) : null
	      return { ok: true, tabId: id }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('terminal.removeTab', async ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
	    try {
	      const st: any = useMainStore.getState()
	      if (typeof st.removeTerminalTab === 'function') st.removeTerminalTab({ context, tabId })
	      return { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('terminal.setActive', async ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
	    try {
	      const st: any = useMainStore.getState()
	      if (typeof st.setActiveTerminal === 'function') st.setActiveTerminal({ context, tabId })
	      return { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('terminal.restartAgent', async ({ tabId }: { tabId: string }) => {
	    try {
	      const st: any = useMainStore.getState()
	      if (typeof st.restartAgentTerminal === 'function') await st.restartAgentTerminal({ tabId })
	      return { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })



	  // Kanban RPCs
	  addMethod('kanban.getBoard', async () => {
	    try {
	      const st: any = useMainStore.getState()
	      return {
	        ok: true,
	        board: st.kanbanBoard || null,
	        loading: !!st.kanbanLoading,
	        saving: !!st.kanbanSaving,
	        error: st.kanbanError || null,
	        lastLoadedAt: st.kanbanLastLoadedAt || null,
	      }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.load', async () => {
	    try {
	      const st: any = useMainStore.getState()
	      const res = await st.kanbanLoad?.()
	      return res || { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.refresh', async () => {
	    try {
	      const st: any = useMainStore.getState()
	      const res = await st.kanbanRefreshFromDisk?.()
	      return res || { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.save', async () => {
	    try {
	      const st: any = useMainStore.getState()
	      const res = await st.kanbanSave?.()
	      return res || { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.createTask', async ({ input }: { input: { title: string; status?: string; epicId?: string | null; description?: string; assignees?: string[]; tags?: string[] } }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const task = await st.kanbanCreateTask?.(input)
	      return { ok: !!task, task: task || null }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.updateTask', async ({ taskId, patch }: { taskId: string; patch: any }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const task = await st.kanbanUpdateTask?.(taskId, patch)
	      return { ok: !!task, task: task || null }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.deleteTask', async ({ taskId }: { taskId: string }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const res = await st.kanbanDeleteTask?.(taskId)
	      return res || { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.moveTask', async ({ taskId, toStatus, toIndex }: { taskId: string; toStatus: string; toIndex: number }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const res = await st.kanbanMoveTask?.({ taskId, toStatus, toIndex })
	      return res || { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.createEpic', async ({ input }: { input: { name: string; color?: string; description?: string } }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const epic = await st.kanbanCreateEpic?.(input)
	      return { ok: !!epic, epic: epic || null }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.updateEpic', async ({ epicId, patch }: { epicId: string; patch: any }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const epic = await st.kanbanUpdateEpic?.(epicId, patch)
	      return { ok: !!epic, epic: epic || null }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

	  addMethod('kanban.deleteEpic', async ({ epicId }: { epicId: string }) => {
	    try {
	      const st: any = useMainStore.getState()
	      const res = await st.kanbanDeleteEpic?.(epicId)
	      return res || { ok: true }
	    } catch (e) {
	      return { ok: false, error: String(e) }
	    }
	  })

  // Flow execution service (JSON-RPC)
  addMethod('flow.start', async (_args: any = {}) => {
    try {
      const st: any = useMainStore.getState()
      // Prefer using the main store action which resets UI state and builds args
      if (typeof st.flowInit === 'function') {
        const res = await st.flowInit()
        // If flowInit explicitly reports a failure, propagate it to the renderer
        if (res && res.ok === false) {
          return { ok: false, error: res.error || 'Flow could not be started', code: (res as any).code }
        }
        // Return the requestId if the store populated it
        try {
          const ns: any = useMainStore.getState()
          const rid = ns?.feRequestId
          if (rid) return { ok: true, requestId: rid }
        } catch {}
        return { ok: true }
      }

      // Fallback: build minimal args from store and execute directly (workspace-scoped)
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }
      const currentId = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
      if (!currentId) return { ok: false, error: 'no-current-session' }
      const requestId = currentId || `flow-init-${Date.now()}`
      const nodes = st.feNodes || []
      const edges = st.feEdges || []
      if (!nodes.length) return { ok: false, error: 'no-flow-loaded' }

      const { reactFlowToFlowDefinition } = await import('../../services/flowConversion.js')
      const flowDef = reactFlowToFlowDefinition(nodes, edges, 'editor-current')

      const list = typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
      const session = Array.isArray(list) ? list.find((s: any) => s.id === currentId) : null
      const initialContext = session?.currentContext

      const pricingConfig = st.pricingConfig
      const modelPricing = (pricingConfig?.[initialContext?.provider || ''] || {})[initialContext?.model || ''] || null

      const rules: string[] = []
      if (st.feRuleEmails) rules.push('emails')
      if (st.feRuleApiKeys) rules.push('apiKeys')
      if (st.feRuleAwsKeys) rules.push('awsKeys')
      if (st.feRuleNumbers16) rules.push('numbers16')
      const maxUSD = (() => { const v = parseFloat(st.feBudgetUSD); return isNaN(v) ? undefined : v })()

      const initArgs: any = {
        sessionId: currentId,

        requestId,
        flowDef,
        initialContext,
        workspaceId: bound || undefined,
        policy: {
          redactor: { enabled: st.feRedactorEnabled, rules },
          budgetGuard: { maxUSD, blockOnExceed: st.feBudgetBlock },
          errorDetection: { enabled: st.feErrorDetectEnabled, blockOnFlag: st.feErrorDetectBlock, patterns: (st.feErrorDetectPatterns || '').split(/[\n,]/g).map((s: string) => s.trim()).filter(Boolean) },
          pricing: modelPricing ? { inputCostPer1M: modelPricing.inputCostPer1M, outputCostPer1M: modelPricing.outputCostPer1M } : undefined,
        },
      }

      const { executeFlow } = await import('../../ipc/flows-v2/index.js')
      void executeFlow(undefined, initArgs).catch((_err) => {
        // Flow start failures are surfaced to the renderer via existing error handling
      })
      // Return requestId so renderer can seed runtime state immediately
      return { ok: true, requestId }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.resume', async ({ requestId, userInput }: { requestId?: string; userInput: string }) => {
    try {
      // Prefer explicit requestId if provided
      let id = requestId

      // If an id was supplied but it's not active, ignore it and fall back
      if (id) {
        try {
          const { listActiveFlows } = await import('../../ipc/flows-v2/index.js')
          const act = listActiveFlows()
          if (!act.includes(id)) id = undefined
        } catch {}
      }

      // If not provided, choose the best target on the scheduler side:
      // 1) A single waiting/paused flow
      // 2) Otherwise, a single active flow
      if (!id) {
        try {
          const { getAllFlowSnapshots, listActiveFlows } = await import('../../ipc/flows-v2/index.js')
          const snaps = getAllFlowSnapshots()
          const waiting = (snaps || []).filter((s: any) => s && (s.status === 'waitingForInput' || !!s.pausedNodeId))
          if (waiting.length === 1) {
            id = waiting[0].requestId
          } else if (!id) {
            const act = listActiveFlows()
            if (Array.isArray(act) && act.length === 1) id = act[0]
          }
        } catch {}

      // Persist user message into the current session before resuming (workspace-scoped)
      try {
        const st: any = useMainStore.getState()
        const bound = getConnectionWorkspaceId(connection)
        if (!bound) throw new Error('no-workspace')
        const sid = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
        if (sid && typeof userInput === 'string' && userInput.trim()) {
          const msg = { type: 'message', id: `msg-${Date.now()}`, role: 'user', content: userInput, timestamp: Date.now() }
          const list = typeof st.getSessionsFor === 'function' ? (st.getSessionsFor({ workspaceId: bound }) || []) : []
          const idx = list.findIndex((sess: any) => sess.id === sid)
          if (idx !== -1 && typeof st.setSessionsFor === 'function') {
            const sess = list[idx]
            const hasMessages = Array.isArray(sess.items) && sess.items.some((i: any) => i.type === 'message')
            let nextTitle = sess.title
            if (!hasMessages) {
              const isInitial = String(nextTitle || '') === initialSessionTitleUtil(sess.createdAt)
              if (isInitial) {
                try { nextTitle = deriveSessionTitle(userInput, sess.createdAt) } catch {}
              }
            }
            const items = [...(sess.items || []), msg]
            const updated = { ...sess, title: nextTitle, items, updatedAt: Date.now(), lastActivityAt: Date.now() }
            const nextList = list.slice(); nextList[idx] = updated
            st.setSessionsFor({ workspaceId: bound, sessions: nextList })
            try {
              const fresh = (useMainStore.getState() as any).getSessionsFor?.({ workspaceId: bound }) || []
              const saved = fresh.find((ss: any) => ss.id === sid)
              if (saved) sessionSaver.save(saved)
            } catch {}
            try {
              broadcastWorkspaceNotification(bound, 'session.timeline.delta', { sessionId: sid, op: 'message', item: msg })
            } catch {}
          }
        }
      } catch {}

      }

      if (!id) return { ok: false, error: 'no-active-flow' }

      const { resumeFlow } = await import('../../ipc/flows-v2/index.js')
      return await resumeFlow(undefined, id, userInput)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.cancel', async ({ requestId }: { requestId?: string }) => {
    try {
      let id = requestId

      // If no explicit id, prefer the store's last flow requestId
      try {
        const st: any = useMainStore.getState()
        if (!id && st?.feRequestId) id = st.feRequestId
      } catch {}

      // As a final fallback, if exactly one active flow exists, cancel it
      if (!id) {
        try {
          const { listActiveFlows } = await import('../../ipc/flows-v2/index.js')
          const active = listActiveFlows()
          if (Array.isArray(active) && active.length === 1) id = active[0]
        } catch {}
      }

      if (!id) return { ok: false, error: 'no-request' }

      const { cancelFlow } = await import('../../ipc/flows-v2/index.js')
      return await cancelFlow(id)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


  addMethod('flow.getActive', async () => {
    try {
      const { listActiveFlows } = await import('../../ipc/flows-v2/index.js')
      const all = listActiveFlows()
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return all
      return all.filter((rid: string) => getWorkspaceIdForSessionId(rid) === bound)
    } catch (e: any) {
      return []
    }
  })

  addMethod('flow.status', async ({ requestId }: { requestId?: string } = {}) => {
    try {
      const { getFlowSnapshot, getAllFlowSnapshots } = await import('../../ipc/flows-v2/index.js')
      if (requestId) {
        const snap = getFlowSnapshot(requestId)
        return snap || { requestId, status: 'stopped', activeNodeIds: [], pausedNodeId: null }
      }
      const bound = getConnectionWorkspaceId(connection)
      const all = getAllFlowSnapshots()
      if (!bound) return all
      return all.filter((s: any) => getWorkspaceIdForSessionId(s.requestId) === bound)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


  addMethod('flows.getTools', async () => {
    try {
      const allTools: any[] = (globalThis as any).__agentTools || []
      const getCategory = useMainStore.getState().getToolCategory as any

      return allTools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        category: typeof getCategory === 'function' ? getCategory(tool.name) : 'other'
      }))
    } catch (error: any) {
      return []
    }
  })
  // Session snapshot for initial hydration of timeline
  addMethod('session.getCurrent', async () => {
    try {
      const st: any = useMainStore.getState()
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return null
      const sid = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
      if (!sid) return null
      const sessions = typeof st.getSessionsFor === 'function' ? (st.getSessionsFor({ workspaceId: bound }) || []) : []
      const sess = sessions.find((s: any) => s.id === sid)
      if (!sess) return null
      return {
        id: sess.id,
        title: sess.title,
        items: Array.isArray(sess.items) ? sess.items : [],
        updatedAt: sess.updatedAt,
        lastActivityAt: sess.lastActivityAt
      }
    } catch (e: any) {
      return null
    }
  })

      // Strict session snapshot for initial hydration of timeline (workspace-scoped only)
      addMethod('session.getCurrentStrict', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return null
          const list = typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
          const currentId = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
          if (!currentId) return null
          const sess = (list || []).find((s: any) => s.id === currentId)
          if (!sess) return null
          return {
            id: sess.id,
            title: sess.title,
            items: Array.isArray(sess.items) ? sess.items : [],
            updatedAt: sess.updatedAt,
            lastActivityAt: sess.lastActivityAt
          }
        } catch (e: any) {
          return null
        }
      })


      // Sessions: list/select/new (lightweight, no timeline)
      addMethod('session.list', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          const list = typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
          const sessions = (list || []).map((s: any) => ({ id: s.id, title: s.title }))
          const currentId = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
          return { ok: true, sessions, currentId }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('session.select', async ({ id }: { id: string }) => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }

          // Reset scheduler for this workspace before switching sessions
          try {
            if (st.workspaceRoot === bound) {
              const isRunning = st.feStatus === 'running' || st.feStatus === 'waitingForInput'
              if (isRunning && typeof st.feStop === 'function') {
                await st.feStop()
              }
            }
          } catch {}

          // Workspace-scoped only - await to ensure save completes
          await st.selectFor({ workspaceId: bound, id })

          const next: any = useMainStore.getState()
          const cur = (typeof next.getCurrentIdFor === 'function') ? next.getCurrentIdFor({ workspaceId: bound }) : null

          // Single source of truth: record selection for this connection and notify
          try { setConnectionSelectedSessionId(connection, cur || id) } catch {}
          try { connection.sendNotification('session.selected', { id: cur || id }) } catch {}

          // Also push the current list for this workspace so renderer doesn't maintain a separate SoT
          try {
            const list = (typeof next.getSessionsFor === 'function') ? next.getSessionsFor({ workspaceId: bound }) : []
            const sessions = (list || []).map((s: any) => ({ id: s.id, title: s.title }))
            connection.sendNotification('session.list.changed', { sessions, currentId: cur || id })
          } catch {}

          // Send full timeline snapshot and contexts for the newly selected session
          try {
            const list = (typeof next.getSessionsFor === 'function') ? next.getSessionsFor({ workspaceId: bound }) : []
            const sess = Array.isArray(list) ? list.find((s: any) => s.id === (cur || id)) : null
            const items = Array.isArray(sess?.items) ? sess.items : []
            connection.sendNotification('session.timeline.snapshot', { sessionId: (cur || id), items })
            const payload = {
              mainContext: sess?.currentContext || null,
              isolatedContexts: {}
            }
            connection.sendNotification('flow.contexts.changed', payload)
          } catch {}

          return { ok: true, currentId: cur || id }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('session.new', async ({ title }: { title?: string } = {}) => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }

          // Reset scheduler before creating/selecting a new session
          try {
            if (st.workspaceRoot === bound) {
              const isRunning = st.feStatus === 'running' || st.feStatus === 'waitingForInput'
              if (isRunning && typeof st.feStop === 'function') {
                await st.feStop()
              }
            }
          } catch {}

          // Save current session before creating new one
          try {
            if (st.workspaceRoot === bound && typeof st.saveCurrentSession === 'function') {
              await st.saveCurrentSession(true)
            }
          } catch {}

          // Workspace-scoped only
          const id = st.newSessionFor({ workspaceId: bound, title })
          const next: any = useMainStore.getState()
          const list = (typeof next.getSessionsFor === 'function') ? next.getSessionsFor({ workspaceId: bound }) : []
          const sessions = (list || []).map((s: any) => ({ id: s.id, title: s.title }))
          const curId = (typeof next.getCurrentIdFor === 'function') ? next.getCurrentIdFor({ workspaceId: bound }) : id
          // Record selection for this connection and push SoT notifications
          try { setConnectionSelectedSessionId(connection, curId) } catch {}
          try { connection.sendNotification('session.selected', { id: curId }) } catch {}
          try { connection.sendNotification('session.list.changed', { sessions, currentId: curId }) } catch {}
          try {
            const sess = Array.isArray(list) ? list.find((s: any) => s.id === curId) : null
            const items = Array.isArray(sess?.items) ? sess.items : []
            connection.sendNotification('session.timeline.snapshot', { sessionId: curId, items })
            connection.sendNotification('flow.contexts.changed', { mainContext: sess?.currentContext || null, isolatedContexts: {} })
          } catch {}
          return { ok: true, id, currentId: curId, sessions }

        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Session: get current meta (id, title, lastUsedFlow)
      addMethod('session.getCurrentMeta', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          const currentId = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
          if (!currentId) return { ok: false, error: 'no-current-session' }
          const list = typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
          const sess = Array.isArray(list) ? list.find((s: any) => s.id === currentId) : null
          if (!sess) return { ok: false, error: 'no-session' }
          return { ok: true, id: sess.id, title: sess.title, lastUsedFlow: sess.lastUsedFlow || '', providerId: (sess.currentContext?.provider || ''), modelId: (sess.currentContext?.model || '') }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Session: set executed flow (stop current run then switch)
      addMethod('session.setExecutedFlow', async ({ sessionId, flowId }: { sessionId: string; flowId: string }) => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)

          if (st.workspaceRoot === bound) {
            // Stop if running
            const isRunning = st.feStatus === 'running' || st.feStatus === 'waitingForInput'
            if (isRunning && typeof st.feStop === 'function') {
              await st.feStop()
            }

            // Update session's lastUsedFlow (workspace-scoped)
            if (typeof st.getSessionsFor === 'function' && typeof st.setSessionsFor === 'function') {
              const list = st.getSessionsFor({ workspaceId: bound }) || []
              const nextList = list.map((s: any) => (s.id === sessionId ? { ...s, lastUsedFlow: flowId, updatedAt: Date.now() } : s))
              st.setSessionsFor({ workspaceId: bound, sessions: nextList })
            }
          }

          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Session: set provider/model (session-scoped); update context immediately without stopping
      addMethod('session.setProviderModel', async ({ sessionId, providerId, modelId }: { sessionId: string; providerId: string; modelId: string }) => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)

          // Only mutate when this connection is bound to the current workspaceRoot
          if (!bound || st.workspaceRoot !== bound) {
            return { ok: false, error: 'workspace-mismatch' }
          }

          let updatedSess: any | null = null

          if (typeof st.setSessionProviderModel === 'function') {
            await st.setSessionProviderModel({ sessionId, provider: providerId, model: modelId })
            // Re-read from store to build an accurate payload for this bound workspace/session
            const fresh: any = useMainStore.getState()
            const list = typeof fresh.getSessionsFor === 'function' ? (fresh.getSessionsFor({ workspaceId: bound }) || []) : []
            updatedSess = Array.isArray(list) ? list.find((s: any) => s.id === sessionId) : null
          } else if (typeof st.getSessionsFor === 'function' && typeof st.setSessionsFor === 'function') {
            // Fallback for older stores: inline update by workspace
            const list = st.getSessionsFor({ workspaceId: bound }) || []
            const nextList = list.map((s: any) => (s.id === sessionId
              ? { ...s, currentContext: { ...(s.currentContext || {}), provider: providerId, model: modelId }, updatedAt: Date.now() }
              : s))
            st.setSessionsFor({ workspaceId: bound, sessions: nextList })
            updatedSess = nextList.find((s: any) => s.id === sessionId) || null
          }

          // Proactively notify this connection so Context Inspector updates immediately,
          // even if this workspace is not the currently active workspaceRoot for subscriptions.
          try {
            if (updatedSess) {
              const payload = {
                mainContext: updatedSess.currentContext || null,
                isolatedContexts: {},
              }
              connection.sendNotification('flow.contexts.changed', payload)
            }
          } catch {}


          try {
            // Also update any active main flow scheduler whose requestId === sessionId
            const { updateActiveFlowProviderModelForSession } = await import('../../ipc/flows-v2/index.js')
            updateActiveFlowProviderModelForSession(sessionId, providerId, modelId)
          } catch (e) {
            try { console.warn('[ws] Failed to update active flow provider/model', e) } catch {}
          }

          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })



      // Session: start a brand-new context (clear timeline + reset messageHistory)
      addMethod('session.newContext', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)

          if (st.workspaceRoot === bound) {
            if (typeof st.startNewContext === 'function') {
              await st.startNewContext()
            } else {
              const running = st.feStatus === 'running' || st.feStatus === 'waitingForInput'
              if (running && typeof st.feStop === 'function') {
                await st.feStop()
              }
              ;(useMainStore as any).setState?.((s: any) => {
                const ws = s.workspaceRoot || null
                if (!ws) return {}
                const prevList: any[] = (s.sessionsByWorkspace?.[ws] || [])
                const cur: string | null = (s.currentIdByWorkspace?.[ws] ?? null)

                const sessions = prevList.map((sess: any) => {
                  if (sess.id !== cur) return sess
                  const now = Date.now()
                  return {
                    ...sess,
                    items: [],
                    currentContext: { ...(sess.currentContext || {}), messageHistory: [] },
                    lastActivityAt: now,
                    updatedAt: now,
                  }
                })

                const patch: any = { openExecutionBoxes: {}, feMainFlowContext: null, feIsolatedContexts: {} }
                patch.sessionsByWorkspace = { ...(s.sessionsByWorkspace || {}), [ws]: sessions }
                patch.currentIdByWorkspace = { ...(s.currentIdByWorkspace || {}), [ws]: cur }
                return patch
              })
            }
          } else if (bound && typeof st.getSessionsFor === 'function' && typeof st.setSessionsFor === 'function' && typeof st.getCurrentIdFor === 'function') {
            const sid = st.getCurrentIdFor({ workspaceId: bound })
            if (sid) {
              const list = st.getSessionsFor({ workspaceId: bound }) || []
              const now = Date.now()
              const nextList = list.map((sess: any) => {
                if (sess.id !== sid) return sess
                return {
                  ...sess,
                  items: [],
                  currentContext: { ...(sess.currentContext || {}), messageHistory: [] },
                  lastActivityAt: now,
                  updatedAt: now,
                }
              })
              // Update per-workspace sessions for this bound (non-active) workspace
              st.setSessionsFor({ workspaceId: bound, sessions: nextList })

              // Actively notify this connection since store subscriptions only broadcast for the active workspace
              try {
                const updatedSess = nextList.find((s: any) => s.id === sid)
                const items = Array.isArray(updatedSess?.items) ? updatedSess.items : []
                connection.sendNotification('session.timeline.snapshot', { sessionId: sid, items })
                const payload = {
                  mainContext: updatedSess?.currentContext || null,
                  isolatedContexts: {}
                }
                connection.sendNotification('flow.contexts.changed', payload)
              } catch {}
            }
          }

          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })



  // Generic tool result fetch (for badges with interactive.data.key)
  addMethod('tool.getResult', async ({ key }: { key: string }) => {
    try {
      const data = UiPayloadCache.peek(String(key))
      return { ok: true, data: typeof data === 'undefined' ? null : data }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Convenience alias for diffs
  addMethod('edits.preview', async ({ key }: { key: string }) => {
    try {
      const data = UiPayloadCache.peek(String(key)) || []
      const arr = Array.isArray(data) ? data : []
      return { ok: true, data: arr }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: get item body
  addMethod('kb.getItemBody', async ({ id }: { id: string }) => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const found = await readById(baseDir, id)
      if (!found) return { ok: false, error: 'not-found' }
      const norm = normalizeMarkdown(found.body ?? '')
      const { body } = extractTrailingMeta(norm)
      const files = (found.meta as any)?.files || []
      return { ok: true, body, files }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
  // Knowledge Base: index reload
  addMethod('kb.reloadIndex', async () => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const items = await listItems(baseDir)
      const map: Record<string, any> = {}
      for (const it of items) map[it.id] = it
      try { (useMainStore as any).setState?.({ kbItems: map }) } catch {}
      return { ok: true, items: map }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: search
  addMethod('kb.search', async ({ query, tags, limit }: { query?: string; tags?: string[]; limit?: number }) => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const qLower = String(query || '').toLowerCase().trim()
      const idx = await getKbIndexer()
      const st1 = idx.status()
      if (!st1.ready || (st1.chunks ?? 0) === 0) {
        try { await idx.rebuild(() => {}) } catch {}
      }
      const items = await listItems(baseDir)
      const byRel: Record<string, any> = {}
      for (const it of items) byRel[String(it.relPath).replace(/^\\?/, '')] = it
      const k = Math.max(100, (typeof limit === 'number' ? limit : 50) * 3)
      let sem = await idx.search(qLower || '', k)
      if ((sem.chunks?.length || 0) === 0) {
        try { await idx.rebuild(() => {}) } catch {}
        sem = await idx.search(qLower || '', k)
      }
      const tagSet = new Set((tags || []).map((t: string) => String(t).toLowerCase()))
      const hasAll = (entryTags: string[]) => {
        if (!tagSet.size) return true
        const lc = new Set((entryTags || []).map((t) => t.toLowerCase()))
        for (const t of tagSet) if (!lc.has(t)) return false
        return true
      }
      const stripPreamble = (s: string) => {
        const ii = s.indexOf('\n\n'); return ii >= 0 ? s.slice(ii + 2) : s
      }
      const seen = new Set<string>()
      const candidates: any[] = []
      sem.chunks.forEach((c: any, i: number) => {
        const p = String(c.path).replace(/^\\?/, '')
        if (seen.has(p)) return
        seen.add(p)
        const meta = byRel[p]
        if (!meta) return
        if (!hasAll(meta.tags)) return
        const baseScore = 1 - i / Math.max(1, sem.chunks.length)
        const body = stripPreamble(String(c.text || ''))
        const titleMatch = qLower && meta.title.toLowerCase().includes(qLower)
        const literalMatch = qLower && body.toLowerCase().includes(qLower)
        const tagBoost = Array.from(tagSet).filter((t) => (meta.tags || []).map((x: string) => x.toLowerCase()).includes(t)).length * 0.05
        const score = baseScore + (titleMatch ? 0.3 : 0) + (literalMatch ? 0.15 : 0) + tagBoost
        const excerpt = body.slice(0, 320)
        candidates.push({ ...meta, excerpt, score })
      })
      candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      let finalResults = candidates
      if (finalResults.length === 0) {
        try {
          const raw: any = await import('../../store/utils/knowledgeBase')
          finalResults = await raw.search(baseDir, { query: qLower, tags, limit: typeof limit === 'number' ? limit : 50 })
        } catch {}
      }
      return { ok: true, results: finalResults.slice(0, typeof limit === 'number' ? limit : 50) }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: create, update, delete
  addMethod('kb.createItem', async ({ title, description, tags, files }: { title: string; description: string; tags?: string[]; files?: string[] }) => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const item = await createItem(baseDir, { title, description: normalizeMarkdown(description), tags, files })
      try { (useMainStore as any).setState?.((s: any) => ({ kbItems: { ...(s?.kbItems || {}), [item.id]: item } })) } catch {}
      return { ok: true, id: item.id, item }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.updateItem', async ({ id, patch }: { id: string; patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }> }) => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const item = await updateItem(baseDir, { id, patch: { ...patch, description: patch.description !== undefined ? normalizeMarkdown(patch.description as any) : undefined } as any })
      if (!item) return { ok: false, error: 'not-found' }
      try { (useMainStore as any).setState?.((s: any) => ({ kbItems: { ...(s?.kbItems || {}), [item.id]: item } })) } catch {}
      return { ok: true, id: item.id, item }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.deleteItem', async ({ id }: { id: string }) => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const ok = await deleteItem(baseDir, id)
      if (ok) {
        try {
          (useMainStore as any).setState?.((s: any) => {
            const map = { ...(s?.kbItems || {}) }
            delete map[id]
            return { kbItems: map }
          })
        } catch {}
        return { ok: true }
      } else {
        return { ok: false, error: 'not-found' }
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: refresh workspace file index
  addMethod('kb.refreshWorkspaceFileIndex', async ({ includeExts, max }: { includeExts?: string[]; max?: number } = {}) => {
    try {
      const st: any = useMainStore.getState()
      const baseDir = st?.workspaceRoot || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
      const files = await listWorkspaceFiles(baseDir, { includeExts, max })
      try { (useMainStore as any).setState?.({ kbWorkspaceFiles: files }) } catch {}
      return { ok: true, files }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


      // Flow Editor: templates and graph management
      addMethod('flowEditor.getTemplates', async () => {
        try {
          // Ensure templates are loaded before responding (handles early renderer hydrate)
          let st: any = useMainStore.getState()
          if (!st.feTemplatesLoaded && typeof st.feLoadTemplates === 'function') {
            try {
              await st.feLoadTemplates()
            } catch (e) {
              // Ignore template load failures; UI can recover on demand
            }
            st = useMainStore.getState()
          }
          return {
            ok: true,
            templates: st.feAvailableTemplates || [],
            templatesLoaded: !!st.feTemplatesLoaded,
            selectedTemplate: st.feSelectedTemplate || '',
            currentProfile: st.feCurrentProfile || '',
            hasUnsavedChanges: !!st.feHasUnsavedChanges,
          }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      addMethod('flowEditor.getGraph', async () => {
        try {
          const st: any = useMainStore.getState()
          return {
            ok: true,
            nodes: Array.isArray(st.feNodes) ? st.feNodes : [],
            edges: Array.isArray(st.feEdges) ? st.feEdges : [],
          }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      // Flow contexts snapshot (main + isolated)
      // Canonical source is the current session's persisted context; ephemeral FE contexts are shown only while running
      addMethod('flow.getContexts', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          const currentId = bound && typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
          const list = bound && typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
          const sess = Array.isArray(list) ? list.find((s: any) => s.id === currentId) : null
          const running = st.feStatus === 'running' || st.feStatus === 'waitingForInput'
          const mainContext = (sess && sess.currentContext)
            ? sess.currentContext
            : (running ? (st.feMainFlowContext || null) : null)
          const isolatedContexts = running ? (st.feIsolatedContexts || {}) : {}
          return {
            ok: true,
            mainContext: mainContext || null,
            isolatedContexts
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Flow cache operations
      addMethod('flow.getNodeCache', async ({ nodeId }: { nodeId: string }) => {
        try {
          const st: any = useMainStore.getState()
          const fn = typeof st.getNodeCache === 'function' ? st.getNodeCache : undefined
          const cache = fn ? fn(nodeId) : undefined
          return { ok: true, cache }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('flow.clearNodeCache', async ({ nodeId }: { nodeId: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.clearNodeCache === 'function') await st.clearNodeCache(nodeId)
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })



      addMethod('flowEditor.setGraph', async ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
        try {
          const st: any = useMainStore.getState()
          const curNodes = Array.isArray(st.feNodes) ? st.feNodes : []
          const curEdges = Array.isArray(st.feEdges) ? st.feEdges : []
          const incomingEmpty = Array.isArray(nodes) && nodes.length === 0 && Array.isArray(edges) && edges.length === 0
          if (incomingEmpty && (curNodes.length > 0 || curEdges.length > 0)) {
            // Ignore empty graph updates to prevent race overwriting during hydration
            return { ok: false, ignored: true, reason: 'empty-graph-ignored' }
          }
          if (typeof st.feSetNodes === 'function') st.feSetNodes({ nodes })
          if (typeof st.feSetEdges === 'function') st.feSetEdges({ edges })
          return { ok: true }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      addMethod('flowEditor.loadTemplate', async ({ templateId }: { templateId: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.feLoadTemplate === 'function') {
            await st.feLoadTemplate({ templateId })
          }
          const ns: any = useMainStore.getState()
          return { ok: true, selectedTemplate: ns.feSelectedTemplate || templateId }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      addMethod('flowEditor.saveAsProfile', async ({ name, library }: { name: string; library?: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.feSaveAsProfile === 'function') {
            await st.feSaveAsProfile({ name, library })
          }
          const ns: any = useMainStore.getState()
          return { ok: true, selectedTemplate: ns.feSelectedTemplate || name }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      addMethod('flowEditor.deleteProfile', async ({ name }: { name: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.feDeleteProfile === 'function') {
            await st.feDeleteProfile({ name })
          }
          return { ok: true }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      addMethod('flowEditor.createNewFlowNamed', async ({ name }: { name: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.feCreateNewFlowNamed === 'function') {
            await st.feCreateNewFlowNamed({ name })
          }
          const ns: any = useMainStore.getState()
          return { ok: true, selectedTemplate: ns.feSelectedTemplate || name }
        } catch (e) {
          return { ok: false, error: String(e) }
        }

      addMethod('flowEditor.exportFlow', async () => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.feExportFlow === 'function') {
            await st.feExportFlow()
          }
          const ns: any = useMainStore.getState()
          return { ok: true, result: ns.feExportResult || null }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      addMethod('flowEditor.importFlow', async () => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.feImportFlow === 'function') {
            await st.feImportFlow()
          }
          const ns: any = useMainStore.getState()
          return { ok: true, result: ns.feImportResult || null }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      })

      // UI: update window state (persisted in main store)
      // UI: get full window state snapshot
      addMethod('window.setContentSize', async ({ width, height }: { width: number; height: number }) => {
        try {
          const { BrowserWindow } = await import('electron')
          const { getWindow } = await import('../../core/window.js')
          const win = BrowserWindow.getFocusedWindow() || getWindow()
          if (!win) return { ok: false, error: 'no-window' }
          try { if (win.isMaximized && win.isMaximized()) { win.unmaximize?.() } } catch {}
          const w = Math.max(300, Math.floor(Number(width) || 0))
          const h = Math.max(300, Math.floor(Number(height) || 0))
          try { (win as any).setContentSize?.(w, h, true) } catch {}
          return { ok: true, width: w, height: h }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Window control handlers via WebSocket JSON-RPC
      addMethod('window.minimize', async () => {
        try {
          const { BrowserWindow } = await import('electron')
          const { getWindow } = await import('../../core/window.js')
          const win = BrowserWindow.getFocusedWindow() || getWindow()
          try { win?.minimize?.() } catch {}
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('window.toggleMaximize', async () => {
        try {
          const { BrowserWindow } = await import('electron')
          const { getWindow } = await import('../../core/window.js')
          const win = BrowserWindow.getFocusedWindow() || getWindow()
          if (!win) return { ok: false, error: 'no-window' }
          try {
            if (win.isMaximized?.()) {
              try { win.unmaximize?.() } catch {}
            } else {
              try { win.maximize?.() } catch {}
            }
            return { ok: true, isMaximized: !!win.isMaximized?.() }
          } catch (e) {
            return { ok: false, error: String(e) }
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Alias: window.maximize -> same behavior as toggleMaximize for convenience
      addMethod('window.maximize', async () => {
        try {
          const { BrowserWindow } = await import('electron')
          const { getWindow } = await import('../../core/window.js')
          const win = BrowserWindow.getFocusedWindow() || getWindow()
          if (!win) return { ok: false, error: 'no-window' }
          try {
            if (win.isMaximized?.()) {
              try { win.unmaximize?.() } catch {}
            } else {
              try { win.maximize?.() } catch {}
            }
            return { ok: true, isMaximized: !!win.isMaximized?.() }
          } catch (e) {
            return { ok: false, error: String(e) }
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


      addMethod('window.close', async () => {
        try {
          const { BrowserWindow } = await import('electron')
          const { getWindow } = await import('../../core/window.js')
          const win = BrowserWindow.getFocusedWindow() || getWindow()
          try { win?.close?.() } catch {}
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('ui.getWindowState', async () => {
        try {
          const st: any = useMainStore.getState()
          const ws = st && typeof st.windowState === 'object' ? st.windowState : {}
          return { ok: true, windowState: ws }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

	      // App boot status snapshot
	      addMethod('app.getBootStatus', async () => {
	        try {
	          const st: any = useMainStore.getState()
	          return { ok: true, appBootstrapping: !!st.appBootstrapping, startupMessage: st.startupMessage || null }
	        } catch (e) {
	          return { ok: false, error: String(e) }
	        }
	      })


      addMethod('ui.updateWindowState', async ({ updates }: { updates: Record<string, any> }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.updateWindowState === 'function') st.updateWindowState(updates)
          if (typeof st.persistWindowState === 'function') st.persistWindowState({ updates })
          return { ok: true }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      // UI: toggle a boolean window state key (no renderer read of current value)
      addMethod('ui.toggleWindowState', async ({ key }: { key: string }) => {
        try {
          const st: any = useMainStore.getState()
          const current = (st.windowState && typeof st.windowState === 'object') ? st.windowState[key] : undefined
          const next = !current
          if (typeof st.updateWindowState === 'function') st.updateWindowState({ [key]: next })
          if (typeof st.persistWindowState === 'function') st.persistWindowState({ updates: { [key]: next } })
          return { ok: true, value: next }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })

      // Settings: snapshot of settings, provider, and indexing (lightweight)
      addMethod('settings.get', async () => {
        try {
          const st: any = useMainStore.getState()
          return {
            ok: true,
            settingsApiKeys: st.settingsApiKeys || {},
            settingsSaving: !!st.settingsSaving,
            settingsSaved: !!st.settingsSaved,
            providerValid: st.providerValid || {},
            modelsByProvider: st.modelsByProvider || {},
            defaultModels: st.defaultModels || {},
            autoRetry: !!st.autoRetry,
            fireworksAllowedModels: st.fireworksAllowedModels || [],
            startupMessage: st.startupMessage || null,
            pricingConfig: st.pricingConfig,
            defaultPricingConfig: st.defaultPricingConfig,
            // Added for StatusBar hydration
            selectedProvider: st.selectedProvider || null,
            selectedModel: st.selectedModel || null,
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Settings: set (partial) API keys in store
      addMethod('settings.setApiKeys', async ({ apiKeys }: { apiKeys: Partial<any> }) => {
        try {
          useMainStore.setState((s: any) => ({ settingsApiKeys: { ...(s.settingsApiKeys || {}), ...(apiKeys || {}) }, settingsSaved: false }))
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Settings: save keys (persist via store middleware)
      addMethod('settings.saveKeys', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.saveSettingsApiKeys === 'function') {
            await anyState.saveSettingsApiKeys()
          }
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Settings: validate keys (updates providerValid and may refresh models)
      addMethod('settings.validateKeys', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.validateApiKeys === 'function') {
            const res = await anyState.validateApiKeys()
            return res || { ok: true, failures: [] }
          }
          return { ok: true, failures: [] }
        } catch (e: any) {
          return { ok: false, failures: [e?.message || String(e)] }
        }
      })

      addMethod('settings.clearResults', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.clearSettingsResults === 'function') anyState.clearSettingsResults()
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Settings: pricing operations
      addMethod('settings.resetPricingToDefaults', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.resetPricingToDefaults === 'function') anyState.resetPricingToDefaults()
          const st: any = useMainStore.getState()
          return { ok: true, pricingConfig: st.pricingConfig, defaultPricingConfig: st.defaultPricingConfig }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('settings.resetProviderPricing', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.resetProviderPricing === 'function') anyState.resetProviderPricing(provider)
          const st: any = useMainStore.getState()
          return { ok: true, pricingConfig: st.pricingConfig }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('settings.setPricingForModel', async ({ provider, model, pricing }: { provider: string; model: string; pricing: any }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.setPricingForModel === 'function') anyState.setPricingForModel({ provider, model, pricing })
          const st: any = useMainStore.getState()
          return { ok: true, pricingConfig: st.pricingConfig }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


      // Provider/model management
      addMethod('provider.refreshModels', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.refreshModels === 'function') {
            await anyState.refreshModels(provider)
          }
          const st = useMainStore.getState() as any
          return { ok: true, models: (st.modelsByProvider || {})[provider] || [] }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('provider.setDefaultModel', async ({ provider, model }: { provider: string; model: string }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.setDefaultModel === 'function') anyState.setDefaultModel({ provider, model })
          return { ok: true }
        } catch (e: any) {

          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('provider.setAutoRetry', async ({ value }: { value: boolean }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.setAutoRetry === 'function') anyState.setAutoRetry(value)
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Fireworks allowlist helpers
      addMethod('provider.fireworks.add', async ({ model }: { model: string }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.addFireworksModel === 'function') anyState.addFireworksModel({ model })
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('provider.fireworks.remove', async ({ model }: { model: string }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.removeFireworksModel === 'function') anyState.removeFireworksModel({ model })
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


      // Provider selection RPCs for StatusBar
      addMethod('provider.setSelectedProvider', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.setSelectedProvider === 'function') anyState.setSelectedProvider(provider)
          const st: any = useMainStore.getState()
          return { ok: true, selectedProvider: st.selectedProvider, selectedModel: st.selectedModel }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('provider.setSelectedModel', async ({ model }: { model: string }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.setSelectedModel === 'function') anyState.setSelectedModel(model)
          const st: any = useMainStore.getState()
          return { ok: true, selectedModel: st.selectedModel }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('provider.fireworks.loadDefaults', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.loadFireworksRecommendedDefaults === 'function') anyState.loadFireworksRecommendedDefaults()
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Indexing APIs
      addMethod('idx.status', async () => {
        try {
          const st: any = useMainStore.getState()
          return {
            ok: true,
            status: st.idxStatus || null,
            progress: st.idxProg || null,
            autoRefresh: st.idxAutoRefresh || null,
            lastRebuildAt: st.idxLastRebuildAt || 0,
          }
        } catch (e: any) {




          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Subscribe to progress updates for this connection
      let idxSubscribed = false
      addMethod('idx.subscribe', async () => {
        if (idxSubscribed) return { ok: true }
        idxSubscribed = true


        try {
          const indexer = await getIndexer()
          try {
            indexer.startWatch((p) => {
              try {
                const nextStatus = {
                  ready: p.ready,
                  chunks: p.chunks,
                  modelId: p.modelId,
                  dim: p.dim,
                  indexPath: p.indexPath,
                }
                const nextProg = {
                  inProgress: p.inProgress,
                  phase: p.phase,
                  processedFiles: p.processedFiles,
                  totalFiles: p.totalFiles,
                  processedChunks: p.processedChunks,
                  totalChunks: p.totalChunks,
                  elapsedMs: p.elapsedMs,
                }
                connection.sendNotification('idx.progress', { status: nextStatus, progress: nextProg })
              } catch {}
            })
          } catch {}
        } catch {}
        return { ok: true }
      })

      addMethod('idx.rebuild', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.rebuildIndex === 'function') {
            return await anyState.rebuildIndex()
          }
          // Fallback direct call if action unavailable
          const indexer = await getIndexer()
          await indexer.rebuild(() => {})
          const s = indexer.status()
          return { ok: true, status: { ready: s.ready, chunks: s.chunks, modelId: s.modelId, dim: s.dim, indexPath: s.indexPath } }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('idx.clear', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.clearIndex === 'function') return await anyState.clearIndex()
          const indexer = await getIndexer(); indexer.clear(); return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('idx.cancel', async () => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.cancelIndexing === 'function') { await anyState.cancelIndexing(); return { ok: true } }
          const indexer = await getIndexer(); indexer.cancel(); return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('idx.setAutoRefresh', async ({ config }: { config: Partial<any> }) => {
        try {
          const anyState: any = useMainStore.getState()
          if (typeof anyState.setIndexAutoRefresh === 'function') anyState.setIndexAutoRefresh({ config })
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('idx.search', async ({ query, limit }: { query: string; limit?: number }) => {
        try {
          const indexer = await getIndexer()
          const res = await indexer.search(String(query || '').trim(), typeof limit === 'number' ? limit : 20)
          return { ok: true, results: res?.chunks || [] }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })




}

let wss: WebSocketServer | null = null
let httpServer: HttpServer | null = null
let bootstrap: WsBootstrap | null = null

/**
 * Start a local WebSocket JSON-RPC server bound to 127.0.0.1 on an ephemeral port.
 * Idempotent: calling again returns the existing bootstrap values.
 */
let bootstrapReady: Promise<WsBootstrap> | null = null
let resolveBootstrap: ((b: WsBootstrap) => void) | null = null

export function startWsBackend(): Promise<WsBootstrap> {
  if (bootstrap && wss) return Promise.resolve(bootstrap)
  if (bootstrapReady) return bootstrapReady

  const token = randomBytes(16).toString('hex')

  httpServer = createServer()
  wss = new WebSocketServer({ server: httpServer, host: '127.0.0.1' })


  // Global: when main store determines workspaceRoot (e.g., after rehydrate/startup),
  // attach any unbound connections to that workspace and emit workspace.attached.
  try {
    ;(useMainStore as any).subscribe?.(
      (s: any) => s.workspaceRoot,
      (next: any, prev: any) => {
        try {
          if (!next || next === prev) return
          if (prev) return // only bind on initial boot (null/undefined -> value)
          const ws = String(next)
          for (const [conn, meta] of Array.from(activeConnections.entries())) {
            if (!meta.workspaceId) {
              try { setConnectionWorkspace(conn, ws) } catch {}
              try { conn.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: ws, root: ws }) } catch {}
            }
          }
        } catch {}
      }
    )
  } catch {}

  // Bind handlers (auth + services)
  wss.on('connection', (ws: WebSocket, req) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const authHeader = req.headers['authorization']
      const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader
      const queryToken = url.searchParams.get('token') || ''
      const supplied = (bearer && bearer.replace(/^Bearer\s+/i, '')) || queryToken
      if (supplied !== token) {
        ws.close(1008, 'Unauthorized')
        return
      }

      // Create JSON-RPC server that sends via WebSocket
      const rpcServer = new JSONRPCServerAndClient(
        new JSONRPCServer(),
        new JSONRPCClient((request) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(request))
          }
        })
      )

      // Create connection wrapper that implements RpcConnection interface
      const connection: RpcConnection = {
        sendNotification: (method: string, params: any) => {
          try {
            if (
              method.startsWith('workspace.') ||
              method.startsWith('session.') ||
              method.startsWith('flow.')
            ) {
              const meta = activeConnections.get(connection) || {}
              console.log('[ws-main] send', method, {
                toWindow: meta.windowId || null,
                workspaceId: meta.workspaceId || null,
              })
            }
          } catch {}
          // Send as notification (no response expected)
          rpcServer.notify(method, params)
        }
      }

      // Handle incoming messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString())
          const response = await rpcServer.receiveAndSend(message)
          if (response !== undefined && response !== null) {
            ws.send(JSON.stringify(response))
          }
        } catch (e) {
          console.error('[ws-main] Failed to process message:', e, 'data:', data.toString())
        }
      })

      // Helper to add RPC methods with logging
      const addMethod = (method: string, handler: (params: any) => any) => {
        rpcServer.addMethod(method, async (params: any) => {
          try {
            if (
              method.startsWith('handshake.') ||
              method.startsWith('workspace.') ||
              method.startsWith('session.') ||
              method.startsWith('flow.')
            ) {
              const meta = activeConnections.get(connection) || {}
              console.log('[ws-main] rpc', method, {
                windowId: meta.windowId || null,
                workspaceId: meta.workspaceId || null,
                params: params ?? null,
              })
            }
          } catch {}
          return handler(params)
        })
      }

      // Add this connection to the broadcast registry early to avoid missing initial broadcasts
      try { registerConnection(connection) } catch {}

      // If a workspaceRoot is already known (e.g., restored on startup), bind immediately ONLY for the first window
      // Rationale: new windows should open to Welcome (unbound) until the user selects a folder
      try {
        const st: any = useMainStore.getState()
        const wsRoot = st.workspaceRoot || null
        if (wsRoot) {
          let anyBound = false
          try {
            for (const [, meta] of activeConnections.entries()) {
              if (meta?.workspaceId) { anyBound = true; break }
            }
          } catch {}
          if (!anyBound) {
            try { setConnectionWorkspace(connection, String(wsRoot)) } catch {}
            try {
              const meta = activeConnections.get(connection) || {}
              connection.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: String(wsRoot), root: String(wsRoot) })
            } catch {}
          }
        }
      } catch {}

      // Health check

      // Lightweight snapshots for UI hydration
      addMethod('workspace.get', async () => {
        try {
          // Prefer the workspace bound to this connection; if none, report null (Welcome)
          const bound = getConnectionWorkspaceId(connection)
          if (bound) return { ok: true, id: bound, workspaceId: bound, root: bound }
          return { ok: true, id: null, workspaceId: null, root: null }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('view.get', async () => {
        try {
          const st: any = useMainStore.getState()
          // If this connection is not bound to a workspace, default to 'welcome'
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: true, currentView: 'welcome' }
          return { ok: true, currentView: st.currentView || 'flow' }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('view.set', async ({ view }: { view: 'welcome' | 'flow' | 'explorer' | 'sourceControl' | 'knowledgeBase' | 'kanban' | 'settings' }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.setCurrentView === 'function') st.setCurrentView({ view })
          const next: any = useMainStore.getState()
          return { ok: true, currentView: next.currentView || view }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })
      // Explorer snapshot and mutations
      addMethod('explorer.getState', async () => {
        try {
          const st: any = useMainStore.getState()
          return {
            ok: true,
            workspaceRoot: st.workspaceRoot || null,
            openFolders: Array.isArray(st.explorerOpenFolders) ? st.explorerOpenFolders : [],
            childrenByDir: st.explorerChildrenByDir || {},
            openedFile: st.openedFile || null,
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('explorer.toggleFolder', async ({ path }: { path: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.toggleExplorerFolder === 'function') await st.toggleExplorerFolder(path)
          const ns: any = useMainStore.getState()
          return {
            ok: true,
            openFolders: Array.isArray(ns.explorerOpenFolders) ? ns.explorerOpenFolders : [],
            childrenByDir: ns.explorerChildrenByDir || {},
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('editor.openFile', async ({ path }: { path: string }) => {
        try {
          const st: any = useMainStore.getState()
          if (typeof st.openFile === 'function') await st.openFile(path)
          const ns: any = useMainStore.getState()
          return { ok: true, openedFile: ns.openedFile || null }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })



      addMethod('session.getMetrics', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          const curRoot = (useMainStore.getState() as any).workspaceRoot || null
          if (bound && curRoot && bound !== curRoot) {
            return { ok: true, metrics: null }
          }
          return { ok: true, metrics: st.agentMetrics || null }
        } catch (e: any) {


	      // Strict usage/costs snapshot for TokensCostsPanel hydration (workspace-scoped only)
	      addMethod('session.getUsageStrict', async () => {
	        try {
	          const st: any = useMainStore.getState()
	          const bound = getConnectionWorkspaceId(connection)
	          if (!bound) return { ok: false, error: 'no-workspace' }
	          const sid = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
	          if (!sid) return { ok: true, usage: null }
	          const list = typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
	          const sess = (list || []).find((s: any) => s.id === sid)
	          if (!sess) return { ok: true, usage: null }
	          const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
	          const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
	          const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []
	          return { ok: true, tokenUsage, costs, requestsLog }
	        } catch (e: any) {
	          return { ok: false, error: e?.message || String(e) }
	        }
	      })

          return { ok: false, error: e?.message || String(e) }
        }
      })


      // Strict usage/costs snapshot for TokensCostsPanel hydration (workspace-scoped only)
      addMethod('session.getUsageStrict', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          const sid = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
          if (!sid) return { ok: true, usage: null }
          const list = typeof st.getSessionsFor === 'function' ? st.getSessionsFor({ workspaceId: bound }) : []
          const sess = (list || []).find((s: any) => s.id === sid)
          if (!sess) return { ok: true, usage: null }
          const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
          const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
          const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []
          return { ok: true, tokenUsage, costs, requestsLog }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

	      // Current session usage/costs snapshot for TokensCostsPanel hydration
	      addMethod('session.getUsage', async () => {
	        try {
	          const st: any = useMainStore.getState()
	          const bound = getConnectionWorkspaceId(connection)
	          if (!bound) return { ok: true, usage: null }
	          const sid = typeof st.getCurrentIdFor === 'function' ? st.getCurrentIdFor({ workspaceId: bound }) : null
	          if (!sid) return { ok: true, usage: null }
	          const list = typeof st.getSessionsFor === 'function' ? (st.getSessionsFor({ workspaceId: bound }) || []) : []
	          const sess = list.find((s: any) => s.id === sid)
	          if (!sess) return { ok: true, usage: null }
	          const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
	          const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
	          const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []
	          return { ok: true, tokenUsage, costs, requestsLog }
	        } catch (e: any) {
	          return { ok: false, error: e?.message || String(e) }
	        }
	      })


      // Capability/boot handshake and optional workspace root
      addMethod('handshake.init', async (args: { windowId?: string; capabilities?: any; workspaceRoot?: string } = {}) => {
        try {
          if (args.windowId) {
            try { setConnectionWindowId(connection, String(args.windowId)) } catch {}
          }
          if (args.workspaceRoot) {
            // Normalize and open requested workspace; allow joining or opening alongside others
            const requestedRaw = String(args.workspaceRoot)
            const requested = path.resolve(requestedRaw)
            try { await useMainStore.getState().openFolder(requested) } catch (e) {}
            try { setConnectionWorkspace(connection, requested) } catch {}
          } else {
            // No explicit root passed. If no other bound connections exist, bind this one to current store root (first window).
            try {
              const othersBound = Array.from(activeConnections.entries()).some(([conn, meta]) => conn !== connection && !!meta.workspaceId)
              if (!othersBound) {
                const st: any = useMainStore.getState()
                const curRoot = st.workspaceRoot || null
                if (curRoot) try { setConnectionWorkspace(connection, String(curRoot)) } catch {}
              }
            } catch {}
          }
        } catch {}

        // New: after binding, emit canonical workspace.attached for this connection
        try {
          const meta = activeConnections.get(connection) || {}
          const ws = getConnectionWorkspaceId(connection)
          if (ws) {
            connection.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: ws, root: ws })
          }
        } catch {}


        // After binding (if any), proactively announce the selected session and hydrate timeline for this connection
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (bound) {
            const sessionsList = (typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: bound }) : []
            const currentId = (typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: bound }) : null
            if (currentId) {
              try { setConnectionSelectedSessionId(connection, currentId) } catch {}
              try { connection.sendNotification('session.selected', { id: currentId }) } catch {}
              try {
                const sess = Array.isArray(sessionsList) ? sessionsList.find((s: any) => s.id === currentId) : null
                const items = Array.isArray(sess?.items) ? sess.items : []
                connection.sendNotification('session.timeline.snapshot', { sessionId: currentId, items })
                connection.sendNotification('flow.contexts.changed', { mainContext: sess?.currentContext || null, isolatedContexts: {} })
              } catch {}
            }
            try {
              const sessions = (sessionsList || []).map((s: any) => ({ id: s.id, title: s.title }))
              connection.sendNotification('session.list.changed', { sessions, currentId: currentId || null })
            } catch {}
            // Tell the renderer that this workspace is fully ready for this connection as well
            try { connection.sendNotification('workspace.ready', { root: bound }) } catch {}
          }
        } catch {}

        return {
          ok: true,
          server: {
            version: 'local-dev',
            planes: { exec: 'local', provider: 'local', fs: 'local' },
            features: ['terminal', 'agent-pty', 'workspace']
          }
        }
      })
      // Strict atomic initial hydration snapshot (workspace-scoped only)
      addMethod('workspace.hydrateStrict', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          const sessionsList = (typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: bound }) : []
          const currentId = (typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: bound }) : null
          const sessions = (sessionsList || []).map((s: any) => ({ id: s.id, title: s.title }))
          const sess = Array.isArray(sessionsList) ? sessionsList.find((s: any) => s.id === currentId) : null
          const items = Array.isArray(sess?.items) ? sess.items : []
          return {
            ok: true,
            workspace: { root: bound },
            sessions: { list: sessions, currentId },
            timeline: { sessionId: currentId, items },
            contexts: { mainContext: sess?.currentContext || null, isolatedContexts: {} },
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


      // Explicit workspace open request (non-blocking; per-window notifications)
      addMethod('workspace.open', async ({ root }: { root: string }) => {
        try {
          // Normalize path for consistent workspace identity
          const requestedRaw = String(root)
          const requested = path.resolve(requestedRaw)
          // If another window already has this workspace open, just join it in this window
          let alreadyOpen = false
          try {
            for (const [conn, meta] of activeConnections.entries()) {
              if (
                conn !== connection &&
                meta.workspaceId &&
                path.resolve(meta.workspaceId) === requested
              ) {
                alreadyOpen = true
                break
              }
            }
          } catch {}

          if (alreadyOpen) {
            try {
              let existingWinId: number | null = null
              let selfWinId: number | null = null
              try {
                const selfMeta = activeConnections.get(connection)
                if (selfMeta?.windowId) selfWinId = parseInt(String(selfMeta.windowId), 10) || null
              } catch {}
              try {
                for (const [conn, meta] of activeConnections.entries()) {
                  if (
                    conn !== connection &&
                    meta.workspaceId &&
                    path.resolve(meta.workspaceId) === requested
                  ) {
                    if (meta.windowId) {
                      existingWinId = parseInt(String(meta.windowId), 10) || null
                      break
                    }
                  }
                }
              } catch {}

              if (existingWinId) {
                try {
                  const bw = BrowserWindow.fromId(existingWinId)
                  try { bw?.show() } catch {}
                  try { if (bw?.isMinimized()) bw.restore() } catch {}
                  try { bw?.focus() } catch {}
                } catch {}
              }
              if (selfWinId) {
                const selfBw = BrowserWindow.fromId(selfWinId)
                setTimeout(() => { try { selfBw?.close() } catch {} }, 50)
              }
            } catch {}
            return { ok: true, focused: true }
          }



          // Bind this connection immediately and notify so UI can show loading state
          try { setConnectionWorkspace(connection, requested) } catch {}
          try { connection.sendNotification('workspace.bound', { root: requested }) } catch {}
          // New: emit canonical workspace.attached with windowId + workspaceId
          try {
            const meta = activeConnections.get(connection) || {}
            connection.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: requested, root: requested })

            // Immediately push a sessions list snapshot (best effort) so renderer can flip hasHydratedList early
            try {
              const st2: any = useMainStore.getState()
              const list = typeof st2.getSessionsFor === 'function' ? (st2.getSessionsFor({ workspaceId: requested }) || []) : []
              const sessions = list.map((s: any) => ({ id: s.id, title: s.title }))
              const curId = typeof st2.getCurrentIdFor === 'function' ? st2.getCurrentIdFor({ workspaceId: requested }) : null
              connection.sendNotification('session.list.changed', { sessions, currentId: curId || null })
            } catch (e) {}
          } catch {}

          // Kick off heavy initialization in the background and report result to this connection only
          ;(async () => {
            try {
              // Transition to loading phase
              transitionConnectionPhase(connection, 'loading')

              const res = await useMainStore.getState().openFolder(requested)
              if (res && res.ok) {
                // Send complete workspace snapshot (replaces piecemeal notifications)
                const snapshotSent = sendWorkspaceSnapshot(connection, requested)

                if (snapshotSent) {
                  // Transition to ready phase
                  transitionConnectionPhase(connection, 'ready')
                  try { connection.sendNotification('workspace.ready', { root: requested }) } catch {}

                  // Also update the selected session ID in connection metadata
                  try {
                    const st2: any = useMainStore.getState()
                    const curId = typeof st2.getCurrentIdFor === 'function' ? st2.getCurrentIdFor({ workspaceId: requested }) : null
                    if (curId) {
                      try { setConnectionSelectedSessionId(connection, curId) } catch {}
                    }
                  } catch {}
                } else {
                  transitionConnectionPhase(connection, 'error')
                }



              } else {
                try { connection.sendNotification('workspace.error', { root: requested, error: (res && (res as any).error) || 'Failed to open workspace' }) } catch {}
              }
            } catch (err: any) {
              try { connection.sendNotification('workspace.error', { root: requested, error: err?.message || String(err) }) } catch {}
            }
          })()

          // Return quickly so the UI can render a per-window loading overlay
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

	      // Atomic initial hydration snapshot pulled by renderer after workspace.ready
	      addMethod('workspace.hydrate', async () => {
	        try {
	          const st: any = useMainStore.getState()
	          const bound = getConnectionWorkspaceId(connection)
	          if (!bound) return { ok: false, error: 'no-workspace' }

	          // Workspace-scoped only
	          const sessionsList = (typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: bound }) : []
	          const currentId = (typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: bound }) : null

	          const sessions = (sessionsList || []).map((s: any) => ({ id: s.id, title: s.title }))
	          const sess = Array.isArray(sessionsList) ? sessionsList.find((s: any) => s.id === currentId) : null
	          const items = Array.isArray(sess?.items) ? sess.items : []

	          return {
	            ok: true,
	            workspace: { root: bound },
	            sessions: { list: sessions, currentId },
	            timeline: { sessionId: currentId, items },
	            contexts: { mainContext: sess?.currentContext || null, isolatedContexts: {} },
	          }
	        } catch (e: any) {
	          return { ok: false, error: e?.message || String(e) }
	        }
	      })


      // Strict hydration: only returns ok:true when sessions are present and a currentId exists
      addMethod('workspace.hydrateStrict', async () => {
        try {
          const st: any = useMainStore.getState()
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }

          let sessionsList = (typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: bound }) : []
          let currentId = (typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: bound }) : null

          // Self-heal: if not ready, attempt to load from disk and/or create an initial session
          if (!(Array.isArray(sessionsList) && sessionsList.length > 0 && currentId)) {
            if (typeof st.loadSessionsFor === 'function') {
              try { await st.loadSessionsFor({ workspaceId: bound }) } catch {}
              sessionsList = (typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: bound }) : []
              currentId = (typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: bound }) : null
            }
            if (!(Array.isArray(sessionsList) && sessionsList.length > 0 && currentId)) {
              if (typeof st.ensureSessionPresentFor === 'function') {
                try { st.ensureSessionPresentFor({ workspaceId: bound }) } catch {}
                sessionsList = (typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: bound }) : []
                currentId = (typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: bound }) : null
              }
            }
          }

          const sessions = (sessionsList || []).map((s: any) => ({ id: s.id, title: s.title }))
          const sess = Array.isArray(sessionsList) ? sessionsList.find((s: any) => s.id === currentId) : null
          const items = Array.isArray(sess?.items) ? sess.items : []

          const ready = Array.isArray(sessionsList) && sessionsList.length > 0 && !!currentId
          if (!ready) return { ok: false, error: 'sessions-not-ready' }

          return {
            ok: true,
            workspace: { root: bound },
            sessions: { list: sessions, currentId },
            timeline: { sessionId: currentId, items },
            contexts: { mainContext: sess?.currentContext || null, isolatedContexts: {} },
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


	      // Recent folders management
	      addMethod('workspace.clearRecentFolders', async () => {
	        try {
	          const st: any = useMainStore.getState()
	          if (typeof st.clearRecentFolders === 'function') st.clearRecentFolders()
	          return { ok: true }
	        } catch (e: any) {
	          return { ok: false, error: e?.message || String(e) }
	        }
	      })

	      addMethod('workspace.listRecentFolders', async () => {
	        try {
	          const st: any = useMainStore.getState()
	          const items = Array.isArray(st.recentFolders) ? st.recentFolders : []
	          return { ok: true, recentFolders: items, folders: items }

	        } catch (e: any) {
	          return { ok: false, error: e?.message || String(e) }
	        }
	      })


      addMethod('handshake.ping', async () => ({ pong: true }))

      // Services
      createTerminalService(addMethod, connection)

      // Subscribe to terminal tabs changes for this connection only
      const unsubTabs = (useMainStore as any).subscribe?.(
        (s: any) => ({
          agentTerminalTabs: s.agentTerminalTabs,
          agentActiveTerminal: s.agentActiveTerminal,
          explorerTerminalTabs: s.explorerTerminalTabs,
          explorerActiveTerminal: s.explorerActiveTerminal,
        }),
        (next: any, prev: any) => {
          try {
            if (!next) return
            // Only send terminal updates when this connection is bound to the active workspace
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (!bound) return
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

            const changed =
              next.agentTerminalTabs !== prev.agentTerminalTabs ||
              next.agentActiveTerminal !== prev.agentActiveTerminal ||
              next.explorerTerminalTabs !== prev.explorerTerminalTabs ||
              next.explorerActiveTerminal !== prev.explorerActiveTerminal
            if (changed) {
              connection.sendNotification('terminal.tabs.changed', {
                agentTabs: Array.isArray(next.agentTerminalTabs) ? next.agentTerminalTabs : [],
                agentActive: next.agentActiveTerminal || null,
                explorerTabs: Array.isArray(next.explorerTerminalTabs) ? next.explorerTerminalTabs : [],
                explorerActive: next.explorerActiveTerminal || null,
              })
            }
          } catch {}
        }
      )


	      // Per-connection: notify on Kanban board changes
	      const unsubKanban = (useMainStore as any).subscribe?.(
	        (s: any) => ({
	          board: s.kanbanBoard,
	          loading: s.kanbanLoading,
	          saving: s.kanbanSaving,
	          error: s.kanbanError,
	          lastLoadedAt: s.kanbanLastLoadedAt,
	        }),
	        (next: any, prev: any) => {
	          try {
	            if (!next) return
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

	            const changed =
	              next.board !== prev.board ||
	              next.loading !== prev.loading ||
	              next.saving !== prev.saving ||
	              next.error !== prev.error ||
	              next.lastLoadedAt !== prev.lastLoadedAt
	            if (changed) {
	              connection.sendNotification('kanban.board.changed', {
	                board: next.board || null,
	                loading: !!next.loading,
	                saving: !!next.saving,

	                error: next.error || null,
	                lastLoadedAt: next.lastLoadedAt || null,
	              })
	            }
	          } catch {}
	        }
	      )


      // Per-connection: notify on Knowledge Base item map changes
      const unsubKb = (useMainStore as any).subscribe?.(
        (s: any) => ({ items: s.kbItems, error: s.kbLastError }),
        (next: any, prev: any) => {
          try {
            if (!next) return
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

            const changed = next.items !== prev.items || next.error !== prev.error
            if (changed) {
              connection.sendNotification('kb.items.changed', {
                items: next.items || {},
                error: next.error || null,
              })
            }
          } catch {}
        }
      )

            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

      // Per-connection: notify on Knowledge Base workspace files list changes
      const unsubKbFiles = (useMainStore as any).subscribe?.(
        (s: any) => ({ files: Array.isArray(s.kbWorkspaceFiles) ? s.kbWorkspaceFiles : [] }),
        (next: any, prev: any) => {
          try {
            if (!next) return
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

            const changed = next.files !== prev.files
            if (changed) {
              connection.sendNotification('kb.files.changed', {
                files: Array.isArray(next.files) ? next.files : [],
              })
            }
          } catch {}
        }
      )

	      // Per-connection: notify on boot status changes
	      const unsubBoot = (useMainStore as any).subscribe?.(
	        (s: any) => ({ appBootstrapping: s.appBootstrapping, startupMessage: s.startupMessage }),
	        (next: any, prev: any) => {
	          try {
	            if (!next) return
	            const changed = next.appBootstrapping !== prev.appBootstrapping || next.startupMessage !== prev.startupMessage
	            if (changed) {
	              connection.sendNotification('app.boot.changed', {
	                appBootstrapping: !!next.appBootstrapping,
	                startupMessage: next.startupMessage || null,
	              })
	            }
	          } catch {}
	        }
	      )
	      // Immediately push current boot status so the renderer doesn't rely solely on snapshot timing
	      try {
	        const st: any = useMainStore.getState()
	        connection.sendNotification('app.boot.changed', {
	          appBootstrapping: !!st.appBootstrapping,
	          startupMessage: st.startupMessage || null,
	        })
	      } catch {}

      // Per-connection: notify on Flow Editor graph/template changes
      const unsubFlowGraph = (useMainStore as any).subscribe?.(
        (s: any) => ({
          selectedTemplate: s.feSelectedTemplate,
          nodes: s.feNodes,
          edges: s.feEdges,
        }),
        (next: any, prev: any) => {
          try {
            if (!next) return
            const changed =
              next.selectedTemplate !== prev.selectedTemplate ||
              next.nodes !== prev.nodes ||
              next.edges !== prev.edges
            if (changed) {
              try {
                const bound = getConnectionWorkspaceId(connection)
                const curRoot = (useMainStore.getState() as any).workspaceRoot || null
                if (bound && curRoot && bound !== curRoot) return
              } catch {}
              connection.sendNotification('flowEditor.graph.changed', {
                selectedTemplate: next.selectedTemplate || '',
                nodesCount: Array.isArray(next.nodes) ? next.nodes.length : 0,
                edgesCount: Array.isArray(next.edges) ? next.edges.length : 0,
              })
            }

          } catch {}
        }
      )

      // Per-connection: notify when provider/models change so selectors can refresh
      const unsubSettingsModels = (useMainStore as any).subscribe?.(
        (s: any) => ({
          providerValid: s.providerValid,
          modelsByProvider: s.modelsByProvider,
        }),
        (next: any, prev: any) => {
          try {
            if (!next) return
            const changed =
              next.providerValid !== prev.providerValid ||
              next.modelsByProvider !== prev.modelsByProvider
            if (!changed) return
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}
            connection.sendNotification('settings.models.changed', {
              providerValid: next.providerValid || {},
              modelsByProvider: next.modelsByProvider || {},
            })
          } catch {}
        }
      )





      // Track connection for global broadcasts

	      // Per-connection: notify on current session usage/costs changes
	      const unsubSessionUsage = (useMainStore as any).subscribe?.(
	        (s: any) => {
	          const ws = getConnectionWorkspaceId(connection) || null
	          const sid = ws && s.currentIdByWorkspace ? (s.currentIdByWorkspace[ws] ?? null) : null
	          const list = ws && s.sessionsByWorkspace ? (s.sessionsByWorkspace[ws] || []) : []
	          const sess = Array.isArray(list) ? list.find((it: any) => it.id === sid) : null
	          return {
	            currentId: sid,
	            totalTokens: sess?.tokenUsage?.total?.totalTokens || 0,
	            totalInput: sess?.tokenUsage?.total?.inputTokens || 0,
	            totalOutput: sess?.tokenUsage?.total?.outputTokens || 0,
	            totalCached: sess?.tokenUsage?.total?.cachedTokens || 0,
	            totalCost: sess?.costs?.totalCost || 0,
	            requestsLen: Array.isArray(sess?.requestsLog) ? sess!.requestsLog.length : 0,
	          }
	        },
	        (next: any, prev: any) => {
	          try {
	            if (!next) return
	            const changed =
	              next.currentId !== prev.currentId ||
	              next.totalTokens !== prev.totalTokens ||
	              next.totalInput !== prev.totalInput ||
	              next.totalOutput !== prev.totalOutput ||
	              next.totalCached !== prev.totalCached ||
	              next.totalCost !== prev.totalCost ||
	              next.requestsLen !== prev.requestsLen
	            if (!changed) return
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

	            const st: any = useMainStore.getState()
	            const ws = st.workspaceRoot || null
	            const sid = (ws && typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: ws }) : null
	            if (!sid) return
	            const list = (ws && typeof st.getSessionsFor === 'function') ? (st.getSessionsFor({ workspaceId: ws }) || []) : []
	            const sess = Array.isArray(list) ? list.find((it: any) => it.id === sid) : null
	            if (!sess) return
	            const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
	            const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }

	            const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []
	            connection.sendNotification('session.usage.changed', { tokenUsage, costs, requestsLog })
	          } catch {}
	        }
	      )

      // Per-connection: notify with full timeline snapshot when current session items array changes
      const unsubTimelineSnapshot = (useMainStore as any).subscribe?.(
        (s: any) => {
          const ws = getConnectionWorkspaceId(connection) || null
          const sid = ws && s.currentIdByWorkspace ? (s.currentIdByWorkspace[ws] ?? null) : null
          const list = ws && s.sessionsByWorkspace ? (s.sessionsByWorkspace[ws] || []) : []
          const sess = Array.isArray(list) ? list.find((it: any) => it.id === sid) : null
          return { sid, itemsRef: sess ? sess.items : null }
        },
        (next: any, prev: any) => {
          try {
            if (!next) return
            const sidChanged = next.sid !== prev.sid
            const itemsChanged = next.itemsRef !== prev.itemsRef
            if (!(sidChanged || itemsChanged)) return

            const st: any = useMainStore.getState()
            const sid = (() => { const ws = (useMainStore.getState() as any).workspaceRoot || null; return (ws && typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: ws }) : null })()
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

            // Announce selection changes as a first-class event for SoT simplicity
            if (sidChanged) {
              try { connection.sendNotification('session.selected', { id: sid || null }) } catch {}
            }

            const ws = (useMainStore.getState() as any).workspaceRoot || null
            const list = (ws && typeof st.getSessionsFor === 'function') ? st.getSessionsFor({ workspaceId: ws }) : []
            const sess = Array.isArray(list) ? list.find((it: any) => it.id === sid) : null
            const items = Array.isArray(sess?.items) ? sess.items : []
            connection.sendNotification('session.timeline.snapshot', { sessionId: sid, items })
          } catch {}
        }
      )

      // Per-connection: notify when sessions list changes (active workspace only)
      const unsubSessionList = (useMainStore as any).subscribe?.(
        (s: any) => {
          const ws = getConnectionWorkspaceId(connection) || null
          const list = ws && s.sessionsByWorkspace ? (s.sessionsByWorkspace[ws] || []) : []
          const cur = ws && s.currentIdByWorkspace ? (s.currentIdByWorkspace[ws] ?? null) : null
          return { ref: list, currentId: cur }
        },
        (next: any, prev: any) => {
          try {
            if (!next) return
            const changed = next.ref !== prev.ref || next.currentId !== prev.currentId
            if (!changed) return
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}
            const st: any = useMainStore.getState()
            const ws = st.workspaceRoot || null
            const list = (ws && typeof st.getSessionsFor === 'function') ? (st.getSessionsFor({ workspaceId: ws }) || []) : []
            const sessions = list.map((s: any) => ({ id: s.id, title: s.title }))
            const currentId = (ws && typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: ws }) : null
            connection.sendNotification('session.list.changed', { sessions, currentId })
          } catch {}
        }
      )



      // Per-connection: notify on flow contexts changes (main + isolated)
      const unsubFlowContexts = (useMainStore as any).subscribe?.(
        (s: any) => {
          const ws = getConnectionWorkspaceId(connection) || null
          const sid = ws && s.currentIdByWorkspace ? (s.currentIdByWorkspace[ws] ?? null) : null
          const list = ws && s.sessionsByWorkspace ? (s.sessionsByWorkspace[ws] || []) : []
          const sess = Array.isArray(list) ? list.find((it: any) => it.id === sid) : null
          const running = s.feStatus === 'running' || s.feStatus === 'waitingForInput'
          return {
            sid,
            // Track refs to detect changes efficiently without deep compares
            mainRef: (sess && sess.currentContext) ? sess.currentContext : (running ? (s.feMainFlowContext || null) : null),
            isoRef: running ? (s.feIsolatedContexts || {}) : {},
          }
        },
        (next: any, prev: any) => {
          try {
            if (!next) return
            const sidChanged = next.sid !== prev.sid
            const mainChanged = next.mainRef !== prev.mainRef
            const isoChanged = next.isoRef !== prev.isoRef
            if (!(sidChanged || mainChanged || isoChanged)) return

            const st: any = useMainStore.getState()
            const ws = st.workspaceRoot || null
            const sid = (ws && typeof st.getCurrentIdFor === 'function') ? st.getCurrentIdFor({ workspaceId: ws }) : null
            const list = (ws && typeof st.getSessionsFor === 'function') ? (st.getSessionsFor({ workspaceId: ws }) || []) : []
            const sess = Array.isArray(list) ? list.find((it: any) => it.id === sid) : null
            const running = st.feStatus === 'running' || st.feStatus === 'waitingForInput'
            try {
              const bound = getConnectionWorkspaceId(connection)
              const curRoot = (useMainStore.getState() as any).workspaceRoot || null
              if (bound && curRoot && bound !== curRoot) return
            } catch {}

            const payload = {
              mainContext: (sess && sess.currentContext) ? sess.currentContext : (running ? (st.feMainFlowContext || null) : null),
              isolatedContexts: running ? (st.feIsolatedContexts || {}) : {}
            }
            connection.sendNotification('flow.contexts.changed', payload)
          } catch {}
        }
      )

      registerConnection(connection)
      ws.on('close', () => {
        unregisterConnection(connection)
        try { unsubTabs?.() } catch {}
        try { unsubKanban?.() } catch {}
        try { unsubKb?.() } catch {}
        try { unsubKbFiles?.() } catch {}

        try { unsubBoot?.() } catch {}
        try { unsubFlowGraph?.() } catch {}
        try { unsubSettingsModels?.() } catch {}
        try { unsubSessionUsage?.() } catch {}
        try { unsubTimelineSnapshot?.() } catch {}
        try { unsubSessionList?.() } catch {}
        try { unsubFlowContexts?.() } catch {}
      })

      // No need to call listen() with json-rpc-2.0 - messages are handled via ws.on('message')
    } catch (err) {
      console.error('[ws-main] Connection setup error:', err)
      try { ws.close(1011, 'Internal error') } catch {}
    }
  })

  bootstrapReady = new Promise<WsBootstrap>((resolve) => { resolveBootstrap = resolve })

  // Listen on ephemeral port and resolve when bound


  httpServer.listen(0, '127.0.0.1', () => {
    try {
      const address = httpServer!.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const url = `ws://127.0.0.1:${port}`
      bootstrap = { url, token }
      resolveBootstrap?.(bootstrap)
    } catch {}
  })

  return bootstrapReady!
}



export function getWsBackendBootstrap(): WsBootstrap | null {
  return bootstrap
}

export function stopWsBackend(): void {
  try { wss?.clients.forEach((c) => c.close()) } catch {}
  try { wss?.close() } catch {}
  try { httpServer?.close() } catch {}
  wss = null
  httpServer = null
  bootstrap = null
}

