import { randomBytes } from 'node:crypto'
import { createServer, Server as HttpServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { JSONRPCServer, JSONRPCServerAndClient, JSONRPCClient } from 'json-rpc-2.0'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow } from 'electron'

import { redactOutput } from '../../utils/security'
import {
  activeConnections,
  registerConnection,
  unregisterConnection,
  setConnectionWorkspace,
  setConnectionWindowId,
  setConnectionSelectedSessionId,
  getConnectionWorkspaceId,
  getConnectionSelectedSessionId,
  transitionConnectionPhase,
  getConnectionPhase,
  incrementSnapshotVersion,
  getSnapshotVersion,
  broadcastWsNotification,
} from './broadcast.js'
import { sendWorkspaceSnapshot } from './snapshot'
import * as agentPty from '../../services/agentPty'
import { flowEvents } from '../../flow-engine/events'
import { ServiceRegistry } from '../../services/base/ServiceRegistry'

import { sessionSaver } from '../../store/utils/session-persistence'
import { UiPayloadCache } from '../../core/uiPayloadCache'
import { getWorkspaceIdForSessionId } from '../../utils/workspace-session'

import { readById, normalizeMarkdown, extractTrailingMeta } from '../../store/utils/knowledgeBase'
import { deriveTitle as deriveSessionTitle, initialSessionTitle as initialSessionTitleUtil } from '../../store/utils/sessions'
import { listItems, createItem, updateItem, deleteItem } from '../../store/utils/knowledgeBase'
import { listWorkspaceFiles } from '../../store/utils/workspace-helpers'
import { getKbIndexer, getIndexer } from '../../core/state'

// Service handlers
import { sessionHandlers, kanbanHandlers, providerHandlers, settingsHandlers, flowHandlers } from './service-handlers.js'
import { getWorkspaceService, getAppService, getIndexingService, getToolsService } from '../../services/index.js'



const require = createRequire(import.meta.url)

function broadcastFlowEvent(ev: any): void {
  try {
    const sid = (ev && typeof ev === 'object') ? (ev.sessionId || null) : null
    const wsFromSid = getWorkspaceIdForSessionId(sid)
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const fallback = workspaceService?.getWorkspaceRoot() || null
    const target = wsFromSid || fallback
    if (target) {
      broadcastWorkspaceNotification(target, 'flow.event', ev)
    }
  } catch { }
}

export interface WsBootstrap {
  url: string
  token: string
}

// Global flow.event forwarder: ensure renderers receive flow events regardless of when executeFlow was called
// We attach ONCE to the 'broadcast' channel and forward all events to the renderer
// This replaces the per-requestId listener pattern which was causing duplicate events
try {
  // Single global listener on the 'broadcast' channel - attached once at startup
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
      } catch { }
    }
  })
} catch { }

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
      } catch { }
    })
    p.onExit(({ exitCode }: { exitCode: number }) => {
      try { connection.sendNotification('terminal.exit', { sessionId, exitCode }) } catch { }
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
    if (s) try { s.p.resize(cols, rows) } catch { }
    return { ok: !!s }
  })

  addMethod('terminal.dispose', async ({ sessionId }: { sessionId: string }) => {
    const s = ptySessions.get(sessionId)
    if (s) {
      try { s.p.kill() } catch { }
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
      } catch { }
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
      const { getTerminalService } = await import('../../services/index.js')
      const terminalService = getTerminalService()

      return {
        ok: true,
        agentTabs: terminalService?.getAgentTerminalTabs() || [],
        agentActive: terminalService?.getAgentActiveTerminal() || null,
        explorerTabs: terminalService?.getExplorerTerminalTabs() || [],
        explorerActive: terminalService?.getExplorerActiveTerminal() || null,
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Terminal tab management RPCs
  addMethod('terminal.addTab', async ({ context }: { context: 'agent' | 'explorer' }) => {
    try {
      const { getTerminalService } = await import('../../services/index.js')
      const terminalService = getTerminalService()
      const id = terminalService?.addTerminalTab(context) || null
      return { ok: true, tabId: id }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('terminal.removeTab', async ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
    try {
      const { getTerminalService } = await import('../../services/index.js')
      const terminalService = getTerminalService()
      terminalService?.removeTerminalTab({ context, tabId })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('terminal.setActive', async ({ context, tabId }: { context: 'agent' | 'explorer'; tabId: string }) => {
    try {
      const { getTerminalService } = await import('../../services/index.js')
      const terminalService = getTerminalService()
      terminalService?.setActiveTerminal({ context, tabId })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('terminal.restartAgent', async ({ tabId }: { tabId: string }) => {
    try {
      const { getTerminalService } = await import('../../services/index.js')
      const terminalService = getTerminalService()
      await terminalService?.restartAgentTerminal({ tabId })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })



  // Kanban RPCs
  addMethod('kanban.getBoard', async () => {
    try {
      return await kanbanHandlers.getBoard()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.load', async () => {
    try {
      return await kanbanHandlers.load()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.refresh', async () => {
    try {
      return await kanbanHandlers.refresh()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.save', async () => {
    try {
      return await kanbanHandlers.save()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.createTask', async ({ input }: { input: { title: string; status?: string; epicId?: string | null; description?: string; assignees?: string[]; tags?: string[] } }) => {
    try {
      return await kanbanHandlers.createTask(input)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.updateTask', async ({ taskId, patch }: { taskId: string; patch: any }) => {
    try {
      return await kanbanHandlers.updateTask(taskId, patch)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.deleteTask', async ({ taskId }: { taskId: string }) => {
    try {
      return await kanbanHandlers.deleteTask(taskId)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.moveTask', async ({ taskId, toStatus, toIndex }: { taskId: string; toStatus: string; toIndex: number }) => {
    try {
      return await kanbanHandlers.moveTask(taskId, toStatus, toIndex)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.createEpic', async ({ input }: { input: { name: string; color?: string; description?: string } }) => {
    try {
      return await kanbanHandlers.createEpic(input)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.updateEpic', async ({ epicId, patch }: { epicId: string; patch: any }) => {
    try {
      return await kanbanHandlers.updateEpic(epicId, patch)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.deleteEpic', async ({ epicId }: { epicId: string }) => {
    try {
      return await kanbanHandlers.deleteEpic(epicId)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('kanban.archiveTasks', async ({ olderThan }: { olderThan: number }) => {
    try {
      return await kanbanHandlers.archiveTasks(olderThan)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Flow execution service (JSON-RPC)
  addMethod('flow.start', async (_args: any = {}) => {
    try {
      // Build args from services and execute directly (workspace-scoped)
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }

      // Get current session
      const sessionService = ServiceRegistry.get<any>('session')
      const currentId = sessionService?.getCurrentIdFor({ workspaceId: bound }) || null
      if (!currentId) return { ok: false, error: 'no-current-session' }

      const requestId = currentId || `flow-init-${Date.now()}`

      // Get flow graph
      const flowGraphService = ServiceRegistry.get<any>('flowGraph')
      const graph = flowGraphService?.getGraph() || { nodes: [], edges: [] }
      const nodes = graph.nodes || []
      const edges = graph.edges || []
      if (!nodes.length) return { ok: false, error: 'no-flow-loaded' }

      const { reactFlowToFlowDefinition } = await import('../../services/flowConversion.js')
      const flowDef = reactFlowToFlowDefinition(nodes, edges, 'editor-current')

      // Get session context
      const list = sessionService?.getSessionsFor({ workspaceId: bound }) || []
      const session = Array.isArray(list) ? list.find((s: any) => s.id === currentId) : null
      const initialContext = session?.currentContext
      if (!initialContext) return { ok: false, error: 'no-session-context' }

      // Get pricing config
      const settingsService = ServiceRegistry.get<any>('settings')
      const pricingConfig = settingsService?.getPricingConfig() || {}
      const modelPricing = (pricingConfig?.[initialContext?.provider || ''] || {})[initialContext?.model || ''] || null

      // Get flow config (redactor, budget, error detection)
      const flowConfigService = ServiceRegistry.get<any>('flowConfig')
      const config = flowConfigService?.getConfig() || {}

      const rules: string[] = []
      if (config.feRuleEmails) rules.push('emails')
      if (config.feRuleApiKeys) rules.push('apiKeys')
      if (config.feRuleAwsKeys) rules.push('awsKeys')
      if (config.feRuleNumbers16) rules.push('numbers16')
      const maxUSD = (() => { const v = parseFloat(config.feBudgetUSD || ''); return isNaN(v) ? undefined : v })()

      const initArgs: any = {
        sessionId: currentId,
        requestId,
        flowDef,
        initialContext,
        workspaceId: bound || undefined,
        policy: {
          redactor: { enabled: config.feRedactorEnabled, rules },
          budgetGuard: { maxUSD, blockOnExceed: config.feBudgetBlock },
          errorDetection: {
            enabled: config.feErrorDetectEnabled,
            blockOnFlag: config.feErrorDetectBlock,
            patterns: (config.feErrorDetectPatterns || '').split(/[\n,]/g).map((s: string) => s.trim()).filter(Boolean)
          },
          pricing: modelPricing ? { inputCostPer1M: modelPricing.inputCostPer1M, outputCostPer1M: modelPricing.outputCostPer1M } : undefined,
        },
      }

      const { executeFlow } = await import('../../flow-engine/index.js')
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
        } catch { }
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
        } catch { }

        // Persist user message into the current session before resuming (workspace-scoped)
        try {
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) throw new Error('no-workspace')

          const { getSessionService, getSessionTimelineService } = await import('../../services/index.js')
          const sessionService = getSessionService()
          const timelineService = getSessionTimelineService()

          const sid = sessionService?.getCurrentIdFor({ workspaceId: bound })
          if (sid && typeof userInput === 'string' && userInput.trim()) {
            const msg = {
              type: 'message' as const,
              id: `msg-${Date.now()}`,
              role: 'user' as const,
              content: userInput,
              timestamp: Date.now()
            }

            // Add message to timeline
            timelineService?.addSessionItem({ workspaceId: bound, sessionId: sid, item: msg })

            // Update session title if this is the first message
            const sessions = sessionService?.getSessionsFor({ workspaceId: bound }) || []
            const sess = sessions.find((s: any) => s.id === sid)
            if (sess) {
              const hasMessages = Array.isArray(sess.items) && sess.items.some((i: any) => i.type === 'message')
              if (!hasMessages) {
                const isInitial = String(sess.title || '') === initialSessionTitleUtil(sess.createdAt)
                if (isInitial) {
                  try {
                    const nextTitle = deriveSessionTitle(userInput, sess.createdAt)
                    sessionService?.renameSession({ workspaceId: bound, sessionId: sid, title: nextTitle })
                  } catch { }
                }
              }
            }

            // Broadcast notification
            try {
              broadcastWorkspaceNotification(bound, 'session.timeline.delta', { sessionId: sid, op: 'message', item: msg })
            } catch { }
          }
        } catch { }

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

      // If no explicit id, check if exactly one active flow exists and cancel it
      if (!id) {
        try {
          const { listActiveFlows } = await import('../../ipc/flows-v2/index.js')
          const active = listActiveFlows()
          if (Array.isArray(active) && active.length === 1) id = active[0]
        } catch { }
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
      const toolsService = ServiceRegistry.get<any>('tools')
      const allTools: any[] = (globalThis as any).__agentTools || []

      return allTools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        category: toolsService ? toolsService.getToolCategory(tool.name) : 'other'
      }))
    } catch (error: any) {
      return []
    }
  })
  // Session snapshot for initial hydration of timeline
  addMethod('session.getCurrent', async () => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return null
      return await sessionHandlers.getCurrent(bound)
    } catch (e: any) {
      return null
    }
  })

  // Strict session snapshot for initial hydration of timeline (workspace-scoped only)
  addMethod('session.getCurrentStrict', async () => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return null
      return await sessionHandlers.getCurrent(bound)
    } catch (e: any) {
      return null
    }
  })


  // Sessions: list/select/new (lightweight, no timeline)
  addMethod('session.list', async () => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }
      return await sessionHandlers.list(bound)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('session.select', async ({ id }: { id: string }) => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }

      // Reset scheduler for this workspace before switching sessions
      try {
        const workspaceService = getWorkspaceService()
        const currentWorkspace = workspaceService?.getWorkspaceRoot()
        if (currentWorkspace === bound) {
          // Stop any running flow via flow-engine
          const { getAllFlowSnapshots, cancelFlow } = await import('../../flow-engine/index.js')
          const allFlows = getAllFlowSnapshots()
          for (const flow of allFlows) {
            if (flow.status === 'running' || flow.status === 'waitingForInput') {
              await cancelFlow(flow.requestId)
            }
          }
        }
      } catch { }

      // Select session via service
      await sessionHandlers.select(bound, id)

      // Get updated session info
      const sessionService = getSessionService()
      const currentId = sessionService.getCurrentIdFor({ workspaceId: bound })

      // Single source of truth: record selection for this connection and notify
      try { setConnectionSelectedSessionId(connection, currentId || id) } catch { }
      try { connection.sendNotification('session.selected', { id: currentId || id }) } catch { }

      // Push the current list for this workspace
      try {
        const list = sessionService.getSessionsFor({ workspaceId: bound })
        const sessions = list.map((s: any) => ({ id: s.id, title: s.title }))
        connection.sendNotification('session.list.changed', { sessions, currentId: currentId || id })
      } catch { }

      // Send full timeline snapshot and contexts for the newly selected session
      try {
        const list = sessionService.getSessionsFor({ workspaceId: bound })
        const sess = list.find((s: any) => s.id === (currentId || id))
        const items = Array.isArray(sess?.items) ? sess.items : []
        connection.sendNotification('session.timeline.snapshot', { sessionId: (currentId || id), items })
        const payload = {
          mainContext: sess?.currentContext || null,
          isolatedContexts: {}
        }
        connection.sendNotification('flow.contexts.changed', payload)
      } catch { }

      return { ok: true, currentId: currentId || id }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('session.new', async ({ title }: { title?: string } = {}) => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }

      // Reset scheduler before creating/selecting a new session
      try {
        const workspaceService = getWorkspaceService()
        const currentWorkspace = workspaceService?.getWorkspaceRoot()
        if (currentWorkspace === bound) {
          // Stop any running flow via flow-engine
          const { getAllFlowSnapshots, cancelFlow } = await import('../../flow-engine/index.js')
          const allFlows = getAllFlowSnapshots()
          for (const flow of allFlows) {
            if (flow.status === 'running' || flow.status === 'waitingForInput') {
              await cancelFlow(flow.requestId)
            }
          }
        }
      } catch { }

      // Subscribe to model changes and broadcast to all clients
      const providerServiceGlobal = ServiceRegistry.get<any>('provider')
      providerServiceGlobal?.on('provider:models:changed', (data: any) => {
        broadcastWsNotification('settings.models.changed', { models: data.modelsByProvider || {} })
        broadcastWsNotification('settings.providerValid.changed', { providerValid: data.providerValid || {} })
      })

      // Save current session before creating new one
      try {
        const sessionService = getSessionService()
        const workspaceService = getWorkspaceService()
        const currentWorkspace = workspaceService?.getWorkspaceRoot()
        if (currentWorkspace === bound) {
          await sessionService.saveCurrentSession(true)
        }
      } catch { }

      // Create new session via service
      const result = await sessionHandlers.newSession(bound, title)
      if (!result.ok) return result

      // Get updated session info
      const sessionService = getSessionService()
      const list = sessionService.getSessionsFor({ workspaceId: bound })
      const sessions = list.map((s: any) => ({ id: s.id, title: s.title }))
      const curId = sessionService.getCurrentIdFor({ workspaceId: bound }) || result.id

      // Record selection for this connection and push SoT notifications
      try { setConnectionSelectedSessionId(connection, curId) } catch { }
      try { connection.sendNotification('session.selected', { id: curId }) } catch { }
      try { connection.sendNotification('session.list.changed', { sessions, currentId: curId }) } catch { }
      try {
        const sess = list.find((s: any) => s.id === curId)
        const items = Array.isArray(sess?.items) ? sess.items : []
        connection.sendNotification('session.timeline.snapshot', { sessionId: curId, items })
        connection.sendNotification('flow.contexts.changed', { mainContext: sess?.currentContext || null, isolatedContexts: {} })
      } catch { }

      return { ok: true, id: result.id, currentId: curId, sessions }

    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Session: get current meta (id, title, lastUsedFlow)
  addMethod('session.getCurrentMeta', async () => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }
      return await sessionHandlers.getCurrentMeta(bound)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Session: set executed flow (stop current run then switch)
  addMethod('session.setExecutedFlow', async ({ sessionId, flowId }: { sessionId: string; flowId: string }) => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      const workspaceService = getWorkspaceService()
      const currentWorkspace = workspaceService?.getWorkspaceRoot()

      if (currentWorkspace === bound) {
        // Stop any running flow via flow-engine
        const { getAllFlowSnapshots, cancelFlow } = await import('../../flow-engine/index.js')
        const allFlows = getAllFlowSnapshots()
        for (const flow of allFlows) {
          if (flow.status === 'running' || flow.status === 'waitingForInput') {
            await cancelFlow(flow.requestId)
          }
        }
      }

      // Update session's lastUsedFlow via service
      return await sessionHandlers.setExecutedFlow(sessionId, flowId)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Session: set provider/model (session-scoped); update context immediately without stopping
  addMethod('session.setProviderModel', async ({ sessionId, providerId, modelId }: { sessionId: string; providerId: string; modelId: string }) => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      const workspaceService = getWorkspaceService()
      const currentWorkspace = workspaceService?.getWorkspaceRoot()

      // Only mutate when this connection is bound to the current workspaceRoot
      if (!bound || currentWorkspace !== bound) {
        return { ok: false, error: 'workspace-mismatch' }
      }

      // Update via service
      const result = await sessionHandlers.setProviderModel(sessionId, providerId, modelId)
      if (!result.ok) return result

      // Get updated session
      const sessionService = getSessionService()
      const list = sessionService.getSessionsFor({ workspaceId: bound })
      const updatedSess = list.find((s: any) => s.id === sessionId)

      // Proactively notify this connection so Context Inspector updates immediately
      try {
        if (updatedSess) {
          const payload = {
            mainContext: updatedSess.currentContext || null,
            isolatedContexts: {},
          }
          connection.sendNotification('flow.contexts.changed', payload)
        }
      } catch { }

      try {
        // Also update any active main flow scheduler whose requestId === sessionId
        const { updateActiveFlowProviderModelForSession } = await import('../../ipc/flows-v2/index.js')
        updateActiveFlowProviderModelForSession(sessionId, providerId, modelId)
      } catch (e) {
        try { console.warn('[ws] Failed to update active flow provider/model', e) } catch { }
      }

      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })



  // Session: start a brand-new context (clear timeline + reset messageHistory)
  addMethod('session.newContext', async () => {
    try {
      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no-workspace' }

      const workspaceService = getWorkspaceService()
      const currentWorkspace = workspaceService?.getWorkspaceRoot()

      // Stop flow if running
      if (currentWorkspace === bound) {
        // Stop any running flow via flow-engine
        const { getAllFlowSnapshots, cancelFlow } = await import('../../flow-engine/index.js')
        const allFlows = getAllFlowSnapshots()
        for (const flow of allFlows) {
          if (flow.status === 'running' || flow.status === 'waitingForInput') {
            await cancelFlow(flow.requestId)
          }
        }
      }

      // Start new context via service
      const result = await sessionHandlers.startNewContext()
      if (!result.ok) return result

      // Get updated session
      const sessionService = getSessionService()
      const sid = sessionService.getCurrentIdFor({ workspaceId: bound })
      if (!sid) return { ok: true }

      const list = sessionService.getSessionsFor({ workspaceId: bound })
      const updatedSess = list.find((s: any) => s.id === sid)

      // Notify this connection
      try {
        const items = Array.isArray(updatedSess?.items) ? updatedSess.items : []
        connection.sendNotification('session.timeline.snapshot', { sessionId: sid, items })
        const payload = {
          mainContext: updatedSess?.currentContext || null,
          isolatedContexts: {}
        }
        connection.sendNotification('flow.contexts.changed', payload)
      } catch { }

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
      const workspaceService = ServiceRegistry.get<any>('workspace')
      const baseDir = workspaceService?.getWorkspaceRoot() || process.env.HIFIDE_WORKSPACE_ROOT || process.cwd()
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
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      if (!kbService) return { ok: false, error: 'knowledge base service not available' }
      await kbService.kbReloadIndex()
      const items = kbService.getItems()
      return { ok: true, items }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: search
  addMethod('kb.search', async ({ query, tags, limit }: { query?: string; tags?: string[]; limit?: number }) => {
    try {
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      if (!kbService) return { ok: false, error: 'knowledge base service not available' }
      await kbService.kbSearch({ query, tags, limit })
      const results = kbService.getSearchResults()
      return { ok: true, results }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: create, update, delete
  addMethod('kb.createItem', async ({ title, description, tags, files }: { title: string; description: string; tags?: string[]; files?: string[] }) => {
    try {
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      if (!kbService) return { ok: false, error: 'knowledge base service not available' }
      await kbService.kbCreateItem({ title, description, tags, files })
      const result = kbService.getOpResult()
      if (result && result.ok) {
        const items = kbService.getItems()
        const item = result.id ? items[result.id] : null
        return { ok: true, id: result.id, item }
      }
      return { ok: false, error: result?.error || 'create failed' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.updateItem', async ({ id, patch }: { id: string; patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }> }) => {
    try {
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      if (!kbService) return { ok: false, error: 'knowledge base service not available' }
      await kbService.kbUpdateItem({ id, patch })
      const result = kbService.getOpResult()
      if (result && result.ok) {
        const items = kbService.getItems()
        const item = result.id ? items[result.id] : null
        return { ok: true, id: result.id, item }
      }
      return { ok: false, error: result?.error || 'update failed' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('kb.deleteItem', async ({ id }: { id: string }) => {
    try {
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      if (!kbService) return { ok: false, error: 'knowledge base service not available' }
      await kbService.kbDeleteItem({ id })
      const result = kbService.getOpResult()
      if (result && result.ok) {
        return { ok: true }
      }
      return { ok: false, error: result?.error || 'delete failed' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Knowledge Base: refresh workspace file index
  addMethod('kb.refreshWorkspaceFileIndex', async ({ includeExts, max }: { includeExts?: string[]; max?: number } = {}) => {
    try {
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      if (!kbService) return { ok: false, error: 'knowledge base service not available' }
      await kbService.kbRefreshWorkspaceFileIndex({ includeExts, max })
      const files = kbService.getWorkspaceFiles()
      return { ok: true, files }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


  // Flow Editor: templates and graph management
  addMethod('flowEditor.getTemplates', async () => {
    try {
      const flowProfileService = ServiceRegistry.get<any>('flowProfile')
      if (!flowProfileService) return { ok: false, error: 'flow profile service not available' }

      // Ensure templates are loaded
      const templates = flowProfileService.getTemplates()
      if (templates.length === 0) {
        try {
          await flowProfileService.initialize()
        } catch (e) {
          // Ignore template load failures; UI can recover on demand
        }
      }

      return {
        ok: true,
        templates: flowProfileService.getTemplates(),
        templatesLoaded: true,
        selectedTemplate: flowProfileService.getSelectedTemplateId() || '',
        currentProfile: '', // UI-specific state, not tracked in service
        hasUnsavedChanges: false, // UI-specific state, not tracked in service
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.getGraph', async () => {
    try {
      const flowGraphService = ServiceRegistry.get<any>('flowGraph')
      if (!flowGraphService) return { ok: false, error: 'flow graph service not available' }

      const graph = flowGraphService.getGraph()
      return {
        ok: true,
        nodes: graph.nodes,
        edges: graph.edges,
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Flow contexts snapshot (main + isolated)
  // Canonical source is the current session's persisted context; ephemeral FE contexts are shown only while running
  addMethod('flow.getContexts', async () => {
    try {
      const sessionService = ServiceRegistry.get<any>('session')
      if (!sessionService) return { ok: false, error: 'session service not available' }

      const bound = getConnectionWorkspaceId(connection)
      if (!bound) return { ok: false, error: 'no workspace bound' }

      const currentId = sessionService.getCurrentIdFor({ workspaceId: bound })
      const list = sessionService.getSessionsFor({ workspaceId: bound })
      const sess = Array.isArray(list) ? list.find((s: any) => s.id === currentId) : null

      // For now, only return the session's persisted context
      // Ephemeral flow execution contexts (feMainFlowContext, feIsolatedContexts) were UI-specific
      // and should be tracked in the renderer or in a dedicated execution context service
      const mainContext = sess?.currentContext || null

      return {
        ok: true,
        mainContext,
        isolatedContexts: {} // Ephemeral contexts not tracked in services yet
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Flow cache operations
  addMethod('flow.getNodeCache', async ({ nodeId }: { nodeId: string }) => {
    try {
      return await flowHandlers.getNodeCache(nodeId)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('flow.clearNodeCache', async ({ nodeId }: { nodeId: string }) => {
    try {
      return await flowHandlers.clearNodeCache(nodeId)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })



  addMethod('flowEditor.setGraph', async ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
    try {
      const { getFlowGraphService } = await import('../../services/index.js')
      const flowGraphService = getFlowGraphService()

      const curGraph = flowGraphService?.getGraph() || { nodes: [], edges: [] }
      const incomingEmpty = Array.isArray(nodes) && nodes.length === 0 && Array.isArray(edges) && edges.length === 0
      if (incomingEmpty && (curGraph.nodes.length > 0 || curGraph.edges.length > 0)) {
        // Ignore empty graph updates to prevent race overwriting during hydration
        return { ok: false, ignored: true, reason: 'empty-graph-ignored' }
      }

      flowGraphService?.setGraph({ nodes, edges })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.loadTemplate', async ({ templateId }: { templateId: string }) => {
    try {
      const { getFlowProfileService } = await import('../../services/index.js')
      const profileService = getFlowProfileService()

      const profile = await profileService?.loadTemplate({ templateId })
      if (!profile) {
        return { ok: false, error: 'Template not found' }
      }

      return {
        ok: true,
        selectedTemplate: templateId,
        nodes: profile.nodes,
        edges: profile.edges
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.saveAsProfile', async ({ name, library, nodes, edges }: { name: string; library?: string; nodes: any[]; edges: any[] }) => {
    try {
      const { getFlowProfileService } = await import('../../services/index.js')
      const profileService = getFlowProfileService()

      await profileService?.saveProfile({
        name,
        library: (library as any) || 'user',
        nodes,
        edges
      })

      return { ok: true, selectedTemplate: name }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.deleteProfile', async ({ name }: { name: string }) => {
    try {
      const { getFlowProfileService } = await import('../../services/index.js')
      const profileService = getFlowProfileService()

      await profileService?.deleteProfile({ name })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.createNewFlowNamed', async ({ name }: { name: string }) => {
    try {
      // For now, creating a new flow is handled by the renderer
      // The renderer will call saveAsProfile when ready
      return { ok: true, selectedTemplate: name }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.exportFlow', async ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
    try {
      const { getFlowProfileService } = await import('../../services/index.js')
      const profileService = getFlowProfileService()

      await profileService?.exportFlow({ nodes, edges })
      const result = profileService?.getExportResult()
      return { ok: true, result: result || null }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  addMethod('flowEditor.importFlow', async () => {
    try {
      const { getFlowProfileService } = await import('../../services/index.js')
      const profileService = getFlowProfileService()

      const profile = await profileService?.importFlow()
      const result = profileService?.getImportResult()
      return {
        ok: true,
        result: result || null,
        profile: profile || null
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // UI: update window state (persisted in main store)
  // UI: get full window state snapshot
  addMethod('window.setContentSize', async ({ width, height }: { width: number; height: number }) => {
    try {
      const { BrowserWindow } = await import('electron')
      const { getWindow } = await import('../../core/window.js')
      const win = BrowserWindow.getFocusedWindow() || getWindow()
      if (!win) return { ok: false, error: 'no-window' }
      try { if (win.isMaximized && win.isMaximized()) { win.unmaximize?.() } } catch { }
      const w = Math.max(300, Math.floor(Number(width) || 0))
      const h = Math.max(300, Math.floor(Number(height) || 0))
      try { (win as any).setContentSize?.(w, h, true) } catch { }
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
      try { win?.minimize?.() } catch { }
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
          try { win.unmaximize?.() } catch { }
        } else {
          try { win.maximize?.() } catch { }
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
          try { win.unmaximize?.() } catch { }
        } else {
          try { win.maximize?.() } catch { }
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
      try { win?.close?.() } catch { }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('ui.getWindowState', async () => {
    try {
      const { getUiService } = await import('../../services/index.js')
      const uiService = getUiService()
      return { ok: true, windowState: uiService.getWindowState() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // App boot status snapshot
  addMethod('app.getBootStatus', async () => {
    try {
      const appService = getAppService()
      const state = appService.getState()
      return { ok: true, appBootstrapping: !!state.appBootstrapping, startupMessage: state.startupMessage || null }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })


  addMethod('ui.updateWindowState', async ({ updates }: { updates: Record<string, any> }) => {
    try {
      const { getUiService } = await import('../../services/index.js')
      const uiService = getUiService()
      uiService.updateWindowState(updates)
      uiService.persistWindowState(updates)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // UI: toggle a boolean window state key (no renderer read of current value)
  addMethod('ui.toggleWindowState', async ({ key }: { key: string }) => {
    try {
      const { getUiService } = await import('../../services/index.js')
      const uiService = getUiService()
      const current = uiService.getWindowState()[key as keyof typeof uiService.getWindowState]
      const next = !current
      uiService.updateWindowState({ [key]: next })
      uiService.persistWindowState({ [key]: next })
      return { ok: true, value: next }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Settings: snapshot of settings, provider, and indexing (lightweight)
  addMethod('settings.get', async () => {
    try {
      return await settingsHandlers.get()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Settings: set (partial) API keys in store
  addMethod('settings.setApiKeys', async ({ apiKeys }: { apiKeys: Partial<any> }) => {
    try {
      return await settingsHandlers.setApiKeys(apiKeys)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Settings: save keys (persist via store middleware)
  addMethod('settings.saveKeys', async () => {
    try {
      return await settingsHandlers.saveKeys()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Settings: validate keys (updates providerValid and may refresh models)
  addMethod('settings.validateKeys', async () => {
    try {
      return await settingsHandlers.validateKeys()
    } catch (e: any) {
      return { ok: false, failures: [e?.message || String(e)] }
    }
  })

  addMethod('settings.clearResults', async () => {
    try {
      return await settingsHandlers.clearResults()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Settings: pricing operations
  addMethod('settings.resetPricingToDefaults', async () => {
    try {
      return await settingsHandlers.resetPricingToDefaults()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('settings.resetProviderPricing', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {
    try {
      return await settingsHandlers.resetProviderPricing(provider)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('settings.setPricingForModel', async ({ provider, model, pricing }: { provider: string; model: string; pricing: any }) => {
    try {
      return await settingsHandlers.setPricingForModel(provider, model, pricing)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


  // Provider/model management
  addMethod('provider.refreshModels', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {
    try {
      return await providerHandlers.refreshModels(provider)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('provider.setDefaultModel', async ({ provider, model }: { provider: string; model: string }) => {
    try {
      return await providerHandlers.setDefaultModel(provider, model)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('provider.setAutoRetry', async ({ value }: { value: boolean }) => {
    try {
      return await providerHandlers.setAutoRetry(value)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Fireworks allowlist helpers
  addMethod('provider.fireworks.add', async ({ model }: { model: string }) => {
    try {
      return await providerHandlers.addFireworksModel(model)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('provider.fireworks.remove', async ({ model }: { model: string }) => {
    try {
      return await providerHandlers.removeFireworksModel(model)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })


  // Provider selection RPCs for StatusBar
  addMethod('provider.setSelectedProvider', async ({ provider }: { provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' }) => {
    try {
      return await providerHandlers.setSelectedProvider(provider)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('provider.setSelectedModel', async ({ model }: { model: string }) => {
    try {
      return await providerHandlers.setSelectedModel(model)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('provider.fireworks.loadDefaults', async () => {
    try {
      return await providerHandlers.loadFireworksDefaults()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // Indexing APIs
  addMethod('idx.status', async () => {
    try {
      const indexingService = getIndexingService()
      const state = indexingService.getState()
      return {
        ok: true,
        status: state.idxStatus || null,
        progress: state.idxProg || null,
        autoRefresh: state.idxAutoRefresh || null,
        lastRebuildAt: state.idxLastRebuildAt || 0,
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
          } catch { }
        })
      } catch { }
    } catch { }
    return { ok: true }
  })

  addMethod('idx.rebuild', async () => {
    try {
      const indexingService = getIndexingService()
      return await indexingService.rebuildIndex()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('idx.clear', async () => {
    try {
      const indexingService = getIndexingService()
      return await indexingService.clearIndex()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('idx.cancel', async () => {
    try {
      const indexingService = getIndexingService()
      await indexingService.cancelIndexing()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  addMethod('idx.setAutoRefresh', async ({ config }: { config: Partial<any> }) => {
    try {
      const indexingService = getIndexingService()
      indexingService.setIndexAutoRefresh({ config })
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


  // Global: when workspace root is determined (e.g., after rehydrate/startup),
  // attach any unbound connections to that workspace and emit workspace.attached.
  try {
    const workspaceServiceGlobal = ServiceRegistry.get<any>('workspace')
    let previousRoot: string | null = null
    workspaceServiceGlobal?.on('workspace:changed', (root: string | null) => {
      try {
        if (!root || root === previousRoot) return
        if (previousRoot) return // only bind on initial boot (null/undefined -> value)
        previousRoot = root
        const ws = String(root)
        for (const [conn, meta] of Array.from(activeConnections.entries())) {
          if (!meta.workspaceId) {
            try { setConnectionWorkspace(conn, ws) } catch { }
            try { conn.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: ws, root: ws }) } catch { }
          }
        }
      } catch { }
    })
  } catch { }

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
          } catch { }
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
          } catch { }
          return handler(params)
        })
      }

      // Add this connection to the broadcast registry early to avoid missing initial broadcasts
      try { registerConnection(connection) } catch { }

      // If a workspaceRoot is already known (e.g., restored on startup), bind immediately ONLY for the first window
      // Rationale: new windows should open to Welcome (unbound) until the user selects a folder
      try {
        const workspaceService = ServiceRegistry.get<any>('workspace')
        const wsRoot = workspaceService?.getWorkspaceRoot() || null
        if (wsRoot) {
          let anyBound = false
          try {
            for (const [, meta] of activeConnections.entries()) {
              if (meta?.workspaceId) { anyBound = true; break }
            }
          } catch { }
          if (!anyBound) {
            try { setConnectionWorkspace(connection, String(wsRoot)) } catch { }
            try {
              const meta = activeConnections.get(connection) || {}
              connection.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: String(wsRoot), root: String(wsRoot) })
            } catch { }
          }
        }
      } catch { }

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
          const { getViewService } = await import('../../services/index.js')
          const viewService = getViewService()

          // If this connection is not bound to a workspace, default to 'welcome'
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: true, currentView: 'welcome' }

          return { ok: true, currentView: viewService.getCurrentView() }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('view.set', async ({ view }: { view: 'welcome' | 'flow' | 'explorer' | 'sourceControl' | 'knowledgeBase' | 'kanban' | 'settings' }) => {
        try {
          const { getViewService } = await import('../../services/index.js')
          const viewService = getViewService()
          viewService.setView(view)
          return { ok: true, currentView: viewService.getCurrentView() }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })
      // Explorer snapshot and mutations
      addMethod('explorer.getState', async () => {
        try {
          const { getExplorerService, getWorkspaceService } = await import('../../services/index.js')
          const explorerService = getExplorerService()
          const workspaceService = getWorkspaceService()

          return {
            ok: true,
            workspaceRoot: workspaceService?.getWorkspaceRoot() || null,
            openFolders: explorerService?.getOpenFolders() || [],
            childrenByDir: explorerService?.getChildrenByDir() || {},
            openedFile: explorerService?.getOpenedFile() || null,
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('explorer.toggleFolder', async ({ path }: { path: string }) => {
        try {
          const { getExplorerService } = await import('../../services/index.js')
          const explorerService = getExplorerService()
          await explorerService?.toggleFolder(path)

          return {
            ok: true,
            openFolders: explorerService?.getOpenFolders() || [],
            childrenByDir: explorerService?.getChildrenByDir() || {},
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('editor.openFile', async ({ path }: { path: string }) => {
        try {
          const { getExplorerService } = await import('../../services/index.js')
          const explorerService = getExplorerService()
          await explorerService?.openFile(path)

          return { ok: true, openedFile: explorerService?.getOpenedFile() || null }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })



      addMethod('session.getMetrics', async () => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = getWorkspaceService()
          const curRoot = workspaceService?.getWorkspaceRoot()
          if (bound && curRoot && bound !== curRoot) {
            return { ok: true, metrics: null }
          }
          // agentMetrics is dead code - never populated, always returns null
          // The actual agent tools use their own session state management
          // TODO: If agent metrics are needed in the future, implement via AgentMetricsService
          return { ok: true, metrics: null }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Strict usage/costs snapshot for TokensCostsPanel hydration (workspace-scoped only)
      addMethod('session.getUsageStrict', async () => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          return await sessionHandlers.getUsage(bound)
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      // Current session usage/costs snapshot for TokensCostsPanel hydration
      addMethod('session.getUsage', async () => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: true, usage: null }
          return await sessionHandlers.getUsage(bound)
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


      // Capability/boot handshake and optional workspace root
      addMethod('handshake.init', async (args: { windowId?: string; capabilities?: any; workspaceRoot?: string } = {}) => {
        try {
          if (args.windowId) {
            try { setConnectionWindowId(connection, String(args.windowId)) } catch { }
          }

          const workspaceService = ServiceRegistry.get<any>('workspace')

          if (args.workspaceRoot) {
            // Normalize and open requested workspace; allow joining or opening alongside others
            const requestedRaw = String(args.workspaceRoot)
            const requested = path.resolve(requestedRaw)
            if (workspaceService) {
              try { await workspaceService.openFolder(requested) } catch (e) { }
            }
            try { setConnectionWorkspace(connection, requested) } catch { }
          } else {
            // No explicit root passed. If no other bound connections exist, bind this one to current store root (first window).
            try {
              const othersBound = Array.from(activeConnections.entries()).some(([conn, meta]) => conn !== connection && !!meta.workspaceId)
              if (!othersBound && workspaceService) {
                const curRoot = workspaceService.getWorkspaceRoot()
                if (curRoot) try { setConnectionWorkspace(connection, String(curRoot)) } catch { }
              }
            } catch { }
          }
        } catch { }

        // New: after binding, emit canonical workspace.attached for this connection
        try {
          const meta = activeConnections.get(connection) || {}
          const ws = getConnectionWorkspaceId(connection)
          if (ws) {
            connection.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: ws, root: ws })
          }
        } catch { }


        // After binding (if any), proactively announce the selected session and hydrate timeline for this connection
        try {
          const sessionService = ServiceRegistry.get<any>('session')
          const bound = getConnectionWorkspaceId(connection)
          if (bound && sessionService) {
            const sessionsList = sessionService.getSessionsFor({ workspaceId: bound })
            const currentId = sessionService.getCurrentIdFor({ workspaceId: bound })
            if (currentId) {
              try { setConnectionSelectedSessionId(connection, currentId) } catch { }
              try { connection.sendNotification('session.selected', { id: currentId }) } catch { }
              try {
                const sess = Array.isArray(sessionsList) ? sessionsList.find((s: any) => s.id === currentId) : null
                const items = Array.isArray(sess?.items) ? sess.items : []
                connection.sendNotification('session.timeline.snapshot', { sessionId: currentId, items })
                connection.sendNotification('flow.contexts.changed', { mainContext: sess?.currentContext || null, isolatedContexts: {} })
              } catch { }
            }
            try {
              const sessions = (sessionsList || []).map((s: any) => ({ id: s.id, title: s.title }))
              connection.sendNotification('session.list.changed', { sessions, currentId: currentId || null })
            } catch { }
            // Tell the renderer that this workspace is fully ready for this connection as well
            try { connection.sendNotification('workspace.ready', { root: bound }) } catch { }
          }
        } catch { }

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
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }

          const sessionService = ServiceRegistry.get<any>('session')
          const sessionsList = sessionService?.getSessionsFor({ workspaceId: bound }) || []
          const currentId = sessionService?.getCurrentIdFor({ workspaceId: bound }) || null
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
          } catch { }

          if (alreadyOpen) {
            try {
              let existingWinId: number | null = null
              let selfWinId: number | null = null
              try {
                const selfMeta = activeConnections.get(connection)
                if (selfMeta?.windowId) selfWinId = parseInt(String(selfMeta.windowId), 10) || null
              } catch { }
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
              } catch { }

              if (existingWinId) {
                try {
                  const bw = BrowserWindow.fromId(existingWinId)
                  try { bw?.show() } catch { }
                  try { if (bw?.isMinimized()) bw.restore() } catch { }
                  try { bw?.focus() } catch { }
                } catch { }
              }
              if (selfWinId) {
                const selfBw = BrowserWindow.fromId(selfWinId)
                setTimeout(() => { try { selfBw?.close() } catch { } }, 50)
              }
            } catch { }
            return { ok: true, focused: true }
          }



          // Bind this connection immediately and notify so UI can show loading state
          try { setConnectionWorkspace(connection, requested) } catch { }
          try { connection.sendNotification('workspace.bound', { root: requested }) } catch { }
          // New: emit canonical workspace.attached with windowId + workspaceId
          try {
            const meta = activeConnections.get(connection) || {}
            connection.sendNotification('workspace.attached', { windowId: meta.windowId || null, workspaceId: requested, root: requested })

            // Immediately push a sessions list snapshot (best effort) so renderer can flip hasHydratedList early
            try {
              const sessionService = ServiceRegistry.get<any>('session')
              if (sessionService) {
                const list = sessionService.getSessionsFor({ workspaceId: requested }) || []
                const sessions = list.map((s: any) => ({ id: s.id, title: s.title }))
                const curId = sessionService.getCurrentIdFor({ workspaceId: requested })
                connection.sendNotification('session.list.changed', { sessions, currentId: curId || null })
              }
            } catch (e) { }
          } catch { }

          // Kick off heavy initialization in the background and report result to this connection only
          ; (async () => {
            try {
              // Transition to loading phase
              transitionConnectionPhase(connection, 'loading')

              const workspaceService = ServiceRegistry.get<any>('workspace')
              const res = workspaceService ? await workspaceService.openFolder(requested) : { ok: false, error: 'workspace service not available' }
              if (res && res.ok) {
                // Send complete workspace snapshot (replaces piecemeal notifications)
                const snapshotSent = sendWorkspaceSnapshot(connection, requested)

                if (snapshotSent) {
                  // Transition to ready phase
                  transitionConnectionPhase(connection, 'ready')
                  try { connection.sendNotification('workspace.ready', { root: requested }) } catch { }

                  // Also update the selected session ID in connection metadata
                  try {
                    const sessionService = ServiceRegistry.get<any>('session')
                    const curId = sessionService ? sessionService.getCurrentIdFor({ workspaceId: requested }) : null
                    if (curId) {
                      try { setConnectionSelectedSessionId(connection, curId) } catch { }
                    }
                  } catch { }
                } else {
                  transitionConnectionPhase(connection, 'error')
                }



              } else {
                try { connection.sendNotification('workspace.error', { root: requested, error: (res && (res as any).error) || 'Failed to open workspace' }) } catch { }
              }
            } catch (err: any) {
              try { connection.sendNotification('workspace.error', { root: requested, error: err?.message || String(err) }) } catch { }
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
          const sessionService = ServiceRegistry.get<any>('session')
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          if (!sessionService) return { ok: false, error: 'session service not available' }

          // Workspace-scoped only
          const sessionsList = sessionService.getSessionsFor({ workspaceId: bound })
          const currentId = sessionService.getCurrentIdFor({ workspaceId: bound })

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
          const sessionService = ServiceRegistry.get<any>('session')
          const bound = getConnectionWorkspaceId(connection)
          if (!bound) return { ok: false, error: 'no-workspace' }
          if (!sessionService) return { ok: false, error: 'session service not available' }

          let sessionsList = sessionService.getSessionsFor({ workspaceId: bound })
          let currentId = sessionService.getCurrentIdFor({ workspaceId: bound })

          // Self-heal: if not ready, attempt to load from disk and/or create an initial session
          if (!(Array.isArray(sessionsList) && sessionsList.length > 0 && currentId)) {
            try { await sessionService.loadSessionsFor({ workspaceId: bound }) } catch { }
            sessionsList = sessionService.getSessionsFor({ workspaceId: bound })
            currentId = sessionService.getCurrentIdFor({ workspaceId: bound })

            if (!(Array.isArray(sessionsList) && sessionsList.length > 0 && currentId)) {
              try { sessionService.ensureSessionPresentFor({ workspaceId: bound }) } catch { }
              sessionsList = sessionService.getSessionsFor({ workspaceId: bound })
              currentId = sessionService.getCurrentIdFor({ workspaceId: bound })
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
          const workspaceService = ServiceRegistry.get<any>('workspace')
          if (!workspaceService) return { ok: false, error: 'workspace service not available' }
          workspaceService.clearRecentFolders()
          return { ok: true }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })

      addMethod('workspace.listRecentFolders', async () => {
        try {
          const workspaceService = ServiceRegistry.get<any>('workspace')
          if (!workspaceService) return { ok: false, error: 'workspace service not available' }
          const items = workspaceService.getRecentFolders()
          return { ok: true, recentFolders: items, folders: items }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      })


      addMethod('handshake.ping', async () => ({ pong: true }))

      // Services
      createTerminalService(addMethod, connection)

      // Subscribe to terminal tabs changes for this connection only
      const terminalService = ServiceRegistry.get<any>('terminal')
      const unsubTabs = terminalService?.on('terminal:tabs:changed', (data: any) => {
        try {
          // Only send terminal updates when this connection is bound to the active workspace
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (!bound) return
          if (bound && curRoot && bound !== curRoot) return

          connection.sendNotification('terminal.tabs.changed', {
            agentTabs: Array.isArray(data.agentTabs) ? data.agentTabs : [],
            agentActive: data.agentActive || null,
            explorerTabs: Array.isArray(data.explorerTabs) ? data.explorerTabs : [],
            explorerActive: data.explorerActive || null,
          })
        } catch { }
      })


      // Per-connection: notify on Kanban board changes
      const kanbanService = ServiceRegistry.get<any>('kanban')
      const unsubKanban = kanbanService?.on('kanban:board:changed', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return

          connection.sendNotification('kanban.board.changed', {
            board: data.board || null,
            loading: !!data.loading,
            saving: !!data.saving,
            error: data.error || null,
            lastLoadedAt: data.lastLoadedAt || null,
          })
        } catch { }
      })


      // Per-connection: notify on Knowledge Base item map changes
      const kbService = ServiceRegistry.get<any>('knowledgeBase')
      const unsubKb = kbService?.on('kb:items:changed', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return

          connection.sendNotification('kb.items.changed', {
            items: data.items || {},
            error: data.error || null,
          })
        } catch { }
      })

      // Per-connection: notify on Knowledge Base workspace files list changes
      const unsubKbFiles = kbService?.on('kb:workspaceFiles:changed', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return

          connection.sendNotification('kb.files.changed', {
            files: Array.isArray(data.files) ? data.files : [],
          })
        } catch { }
      })

      // Per-connection: notify on boot status changes
      const appService = ServiceRegistry.get<any>('app')
      const unsubBoot = appService?.on('app:boot:changed', (data: any) => {
        try {
          connection.sendNotification('app.boot.changed', {
            appBootstrapping: !!data.appBootstrapping,
            startupMessage: data.startupMessage || null,
          })
        } catch { }
      })
      // Immediately push current boot status so the renderer doesn't rely solely on snapshot timing
      try {
        connection.sendNotification('app.boot.changed', {
          appBootstrapping: !!appService?.isBootstrapping(),
          startupMessage: appService?.getStartupMessage() || null,
        })
      } catch { }

      // Per-connection: notify on Flow Editor graph/template changes
      const flowGraphService = ServiceRegistry.get<any>('flowGraph')
      const unsubFlowGraph = flowGraphService?.on('flowGraph:changed', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return

          connection.sendNotification('flowEditor.graph.changed', {
            selectedTemplate: '', // selectedTemplate is UI-specific, not tracked in FlowGraphService
            nodesCount: Array.isArray(data.nodes) ? data.nodes.length : 0,
            edgesCount: Array.isArray(data.edges) ? data.edges.length : 0,
          })
        } catch { }
      })

      // Per-connection: notify when provider/models change so selectors can refresh
      const providerService = ServiceRegistry.get<any>('provider')
      const unsubSettingsModels = providerService?.on('provider:models:changed', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return

          connection.sendNotification('settings.models.changed', {
            providerValid: data.providerValid || {},
            modelsByProvider: data.modelsByProvider || {},
          })
        } catch { }
      })





      // Track connection for global broadcasts

      // Per-connection: notify on current session usage/costs changes
      const sessionService = ServiceRegistry.get<any>('session')
      const unsubSessionUsage = sessionService?.on('sessions:updated', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return
          if (data.workspaceId !== curRoot) return

          const sid = sessionService?.getCurrentIdFor({ workspaceId: data.workspaceId })
          if (!sid) return

          const sess = Array.isArray(data.sessions) ? data.sessions.find((it: any) => it.id === sid) : null
          if (!sess) return

          const tokenUsage = sess.tokenUsage || { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }, byProvider: {}, byProviderAndModel: {} }
          const costs = sess.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
          const requestsLog = Array.isArray(sess.requestsLog) ? sess.requestsLog : []

          connection.sendNotification('session.usage.changed', { tokenUsage, costs, requestsLog })
        } catch { }
      })

      // Per-connection: notify with full timeline snapshot when current session changes
      const unsubTimelineSnapshot = sessionService?.on('session:selected', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return
          if (data.workspaceId !== curRoot) return

          // Announce selection changes as a first-class event for SoT simplicity
          try { connection.sendNotification('session.selected', { id: data.sessionId || null }) } catch { }

          const sessions = sessionService?.getSessionsFor({ workspaceId: data.workspaceId }) || []
          const sess = Array.isArray(sessions) ? sessions.find((it: any) => it.id === data.sessionId) : null
          const items = Array.isArray(sess?.items) ? sess.items : []
          connection.sendNotification('session.timeline.snapshot', { sessionId: data.sessionId, items })
        } catch { }
      })

      // Per-connection: notify when sessions list changes (active workspace only)
      const unsubSessionList = sessionService?.on('sessions:updated', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return
          if (data.workspaceId !== curRoot) return

          const sessions = Array.isArray(data.sessions) ? data.sessions.map((s: any) => ({ id: s.id, title: s.title })) : []
          const currentId = sessionService?.getCurrentIdFor({ workspaceId: data.workspaceId })
          connection.sendNotification('session.list.changed', { sessions, currentId })
        } catch { }
      })



      // Per-connection: notify on flow contexts changes (session's currentContext)
      const unsubFlowContexts = sessionService?.on('sessions:updated', (data: any) => {
        try {
          const bound = getConnectionWorkspaceId(connection)
          const workspaceService = ServiceRegistry.get<any>('workspace')
          const curRoot = workspaceService?.getWorkspaceRoot() || null
          if (bound && curRoot && bound !== curRoot) return
          if (data.workspaceId !== curRoot) return

          const sid = sessionService?.getCurrentIdFor({ workspaceId: data.workspaceId })
          if (!sid) return

          const sess = Array.isArray(data.sessions) ? data.sessions.find((it: any) => it.id === sid) : null
          const payload = {
            mainContext: sess?.currentContext || null,
            isolatedContexts: {} // Isolated contexts are flow-editor specific, removed
          }
          connection.sendNotification('flow.contexts.changed', payload)
        } catch { }
      })

      registerConnection(connection)
      ws.on('close', () => {
        unregisterConnection(connection)
        try { unsubTabs?.() } catch { }
        try { unsubKanban?.() } catch { }
        try { unsubKb?.() } catch { }
        try { unsubKbFiles?.() } catch { }

        try { unsubBoot?.() } catch { }
        try { unsubFlowGraph?.() } catch { }
        try { unsubSettingsModels?.() } catch { }
        try { unsubSessionUsage?.() } catch { }
        try { unsubTimelineSnapshot?.() } catch { }
        try { unsubSessionList?.() } catch { }
        try { unsubFlowContexts?.() } catch { }
      })

      // No need to call listen() with json-rpc-2.0 - messages are handled via ws.on('message')
    } catch (err) {
      console.error('[ws-main] Connection setup error:', err)
      try { ws.close(1011, 'Internal error') } catch { }
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
    } catch { }
  })

  return bootstrapReady!
}



export function getWsBackendBootstrap(): WsBootstrap | null {
  return bootstrap
}

export function stopWsBackend(): void {
  try { wss?.clients.forEach((c) => c.close()) } catch { }
  try { wss?.close() } catch { }
  try { httpServer?.close() } catch { }
  wss = null
  httpServer = null
  bootstrap = null
}

