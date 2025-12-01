/**
 * Timeline Event Handler
 * 
 * Listens to flow execution events and persists them to session timeline.
 * 
 * ARCHITECTURE:
 * - Main process: Receives raw events, stores minimal data in session
 * - Renderer: Reads session data, handles ALL presentation/formatting logic
 * 
 * This handler is responsible ONLY for:
 * 1. Buffering streaming text/reasoning (debounced)
 * 2. Creating node execution boxes in session timeline
 * 3. Storing raw tool call data (args, results, errors)
 * 4. Tracking token usage
 * 5. Broadcasting changes to renderers
 * 
 * This handler is NOT responsible for:
 * - Badge formatting (renderer's job)
 * - UI presentation logic (renderer's job)
 * - Diff computation (renderer's job)
 * - File path extraction (renderer's job)
 */

import type { FlowExecutionArgs } from './types.js'
import type { NodeExecutionBox } from '../store/types.js'
import { flowEvents } from './events.js'
import { broadcastWorkspaceNotification } from '../backend/ws/broadcast.js'
import { getWorkspaceIdForSessionId } from '../utils/workspace-session.js'
import { ServiceRegistry } from '../services/base/ServiceRegistry.js'

interface NodeMetadata {
  label: string
  kind: string
}

interface ExecutionBuffers {
  text: Map<string, string>              // Buffered streaming text
  reasoning: Map<string, string>         // Buffered reasoning text
  toolCalls: Map<string, any[]>          // Raw tool call data
  openBoxIds: Map<string, string>        // nodeId::execId -> boxId
}

/**
 * Start listening to flow events and persist to session timeline
 */
export function startTimelineListener(requestId: string, args: FlowExecutionArgs): () => void {
  const sessionId = (args as any).sessionId as string | undefined
  if (!sessionId) {
    return () => {}
  }

  console.log('[TimelineEventHandler] Starting listener:', { requestId, sessionId })

  // Build node metadata lookup
  const nodeMeta = new Map<string, NodeMetadata>()
  try {
    for (const n of args.flowDef?.nodes || []) {
      const label =
        (n as any)?.data?.label ||
        (n as any)?.data?.labelBase ||
        (n as any)?.data?.nodeType ||
        'Node'
      const kind = (n as any)?.data?.nodeType || (n as any)?.type || 'unknown'
      nodeMeta.set((n as any).id, { label, kind })
    }
  } catch {}

  // Initialize buffers
  const buffers: ExecutionBuffers = {
    text: new Map(),
    reasoning: new Map(),
    toolCalls: new Map(),
    openBoxIds: new Map(),
  }

  // Helper: Get execution key
  const getKey = (nodeId: string, executionId?: string) =>
    executionId ? `${nodeId}::${executionId}` : nodeId

  // Helper: Flush buffered content to session
  const flush = (key: string) => {
    try {
      const [nodeId, executionId] = key.split('::')
      const text = buffers.text.get(key) || ''
      const reasoning = buffers.reasoning.get(key) || ''
      const toolCalls = buffers.toolCalls.get(key) || []

      // Nothing to flush?
      if (!text.trim() && !reasoning && toolCalls.length === 0) {
        return
      }

      const sessionService = ServiceRegistry.getInstance().get<any>('session')
      const workspaceService = ServiceRegistry.getInstance().get<any>('workspace')
      if (!sessionService || !workspaceService) return

      const ws = getWorkspaceIdForSessionId(sessionId) || workspaceService.getWorkspaceRoot()
      if (!ws) return

      const sessions = sessionService.getSessionsFor({ workspaceId: ws })
      const sessionIndex = sessions.findIndex((s: any) => s.id === sessionId)
      if (sessionIndex === -1) return

    const session = sessions[sessionIndex]
    const items = Array.isArray(session.items) ? [...session.items] : []

    const meta = nodeMeta.get(nodeId) || { label: 'Node', kind: 'unknown' }
    let boxId = buffers.openBoxIds.get(key)

    if (!boxId) {
      // Create new box
      boxId = `box-${nodeId}-${executionId || Date.now()}`
      buffers.openBoxIds.set(key, boxId)

      const newBox: NodeExecutionBox = {
        type: 'node-execution',
        id: boxId,
        nodeId,
        nodeLabel: meta.label,
        nodeKind: meta.kind,
        timestamp: Date.now(),
        content: [],
      }

      if (reasoning) newBox.content.push({ type: 'reasoning', text: reasoning })
      if (text.trim()) newBox.content.push({ type: 'text', text })
      for (const tool of toolCalls) {
        newBox.content.push({ type: 'badge', badge: tool })
      }

      items.push(newBox)
    } else {
      // Update existing box
      const boxIndex = items.findIndex((item: any) => item.id === boxId)
      if (boxIndex >= 0) {
        const box = { ...items[boxIndex] } as NodeExecutionBox
        const content = [...box.content]

        if (reasoning) content.push({ type: 'reasoning', text: reasoning })
        if (text.trim()) content.push({ type: 'text', text })
        for (const tool of toolCalls) {
          content.push({ type: 'badge', badge: tool })
        }

        items[boxIndex] = { ...box, content }
      }
    }

    // Save to session
    const updatedSessions = [...sessions]
    updatedSessions[sessionIndex] = {
      ...session,
      items,
      updatedAt: Date.now(),
    }

    sessionService.setSessionsFor({ workspaceId: ws, sessions: updatedSessions })

    // Persist to disk (debounced)
    console.log('[TimelineEventHandler] Calling saveSessionFor:', { workspaceId: ws, sessionId, itemCount: items.length })
    sessionService.saveSessionFor({ workspaceId: ws, sessionId }, false)

    // Broadcast delta to renderer (incremental update, not full snapshot)
    const delta = {
      op: 'appendToBox',
      nodeId,
      executionId,
      append: {
        text: text || undefined,  // Don't trim - preserves spaces between chunks
        reasoning: reasoning || undefined,
        badges: toolCalls.length > 0 ? toolCalls : undefined,
      },
    }
    broadcastWorkspaceNotification(ws, 'session.timeline.delta', delta)

      // Clear buffers
      buffers.text.delete(key)
      buffers.reasoning.delete(key)
      buffers.toolCalls.delete(key)
    } catch (error) {
      console.error('[TimelineEventHandler] flush() error:', error)
    }
  }

  // Helper: Broadcast usage update
  const broadcastUsage = () => {
    try {
      const sessionService = ServiceRegistry.getInstance().get<any>('session')
      const workspaceService = ServiceRegistry.getInstance().get<any>('workspace')
      if (!sessionService || !workspaceService) return

      const ws = getWorkspaceIdForSessionId(sessionId) || workspaceService.getWorkspaceRoot()
      if (!ws) return

      const sessions = sessionService.getSessionsFor({ workspaceId: ws })
      const session = sessions.find((s: any) => s.id === sessionId)
      if (!session) return

      const tokenUsage = session.tokenUsage || {
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 },
        byProvider: {},
        byProviderAndModel: {},
      }
      const costs = session.costs || {
        byProviderAndModel: {},
        totalCost: 0,
        currency: 'USD',
      }
      const requestsLog = Array.isArray(session.requestsLog) ? session.requestsLog : []

      broadcastWorkspaceNotification(ws, 'session.usage.changed', {
        tokenUsage,
        costs,
        requestsLog,
      })
    } catch (e) {
      console.warn('[TimelineEventHandler] broadcastUsage failed:', e)
    }
  }

  // Event listener
  const unsubscribe = flowEvents.onFlowEvent(requestId, (ev: any) => {
    const { type, nodeId, executionId } = ev
    if (!nodeId) return

    const key = getKey(nodeId, executionId)

    switch (type) {
      case 'chunk':
        // Buffer streaming text and flush immediately
        if (ev.text) {
          const prev = buffers.text.get(key) || ''
          buffers.text.set(key, prev + ev.text)
          flush(key)
        }
        break

      case 'reasoning':
        // Buffer streaming reasoning and flush immediately
        if (ev.text) {
          const prev = buffers.reasoning.get(key) || ''
          buffers.reasoning.set(key, prev + ev.text)
          flush(key)
        }
        break

      case 'toolStart':
        // Store raw tool call data (renderer will format)
        {
          const toolCalls = buffers.toolCalls.get(key) || []
          toolCalls.push({
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            toolName: ev.toolName,
            callId: ev.callId,
            args: ev.toolArgs,
            status: 'executing',
            timestamp: Date.now(),
          })
          buffers.toolCalls.set(key, toolCalls)
          flush(key) // Immediate flush for tool start
        }
        break

      case 'toolEnd':
        // Update tool call with result
        {
          const toolCalls = buffers.toolCalls.get(key) || []
          const tool = toolCalls.find((t) => t.callId === ev.callId)
          if (tool) {
            tool.status = 'success'
            tool.result = ev.result
            tool.endTimestamp = Date.now()
            flush(key) // Immediate flush for tool end
          }
        }
        break

      case 'toolError':
        // Update tool call with error
        {
          const toolCalls = buffers.toolCalls.get(key) || []
          const tool = toolCalls.find((t) => t.callId === ev.callId)
          if (tool) {
            tool.status = 'error'
            tool.error = ev.error
            tool.endTimestamp = Date.now()
            flush(key) // Immediate flush for tool error
          }
        }
        break

      case 'tokenUsage':
        // Update session token usage
        {
          const sessionService = ServiceRegistry.getInstance().get<any>('session')
          const workspaceService = ServiceRegistry.getInstance().get<any>('workspace')
          if (!sessionService || !workspaceService) break

          const ws = workspaceService.getWorkspaceRoot()
          if (!ws) break

          const sessions = sessionService.getSessionsFor({ workspaceId: ws })
          const sessionIndex = sessions.findIndex((s: any) => s.id === sessionId)
          if (sessionIndex === -1) break

          const session = sessions[sessionIndex]
          const tokenUsage = session.tokenUsage || {
            total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 },
            byProvider: {},
            byProviderAndModel: {},
          }

          // Update totals
          tokenUsage.total.inputTokens += ev.usage.inputTokens || 0
          tokenUsage.total.outputTokens += ev.usage.outputTokens || 0
          tokenUsage.total.totalTokens += ev.usage.totalTokens || 0
          tokenUsage.total.cachedTokens += ev.usage.cachedTokens || 0

          // Update by provider
          const providerKey = ev.provider
          if (!tokenUsage.byProvider[providerKey]) {
            tokenUsage.byProvider[providerKey] = {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cachedTokens: 0,
            }
          }
          tokenUsage.byProvider[providerKey].inputTokens += ev.usage.inputTokens || 0
          tokenUsage.byProvider[providerKey].outputTokens += ev.usage.outputTokens || 0
          tokenUsage.byProvider[providerKey].totalTokens += ev.usage.totalTokens || 0
          tokenUsage.byProvider[providerKey].cachedTokens += ev.usage.cachedTokens || 0

          // Update by provider and model
          const modelKey = `${ev.provider}/${ev.model}`
          if (!tokenUsage.byProviderAndModel[modelKey]) {
            tokenUsage.byProviderAndModel[modelKey] = {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cachedTokens: 0,
            }
          }
          tokenUsage.byProviderAndModel[modelKey].inputTokens += ev.usage.inputTokens || 0
          tokenUsage.byProviderAndModel[modelKey].outputTokens += ev.usage.outputTokens || 0
          tokenUsage.byProviderAndModel[modelKey].totalTokens += ev.usage.totalTokens || 0
          tokenUsage.byProviderAndModel[modelKey].cachedTokens += ev.usage.cachedTokens || 0

          // Save
          const updatedSessions = [...sessions]
          updatedSessions[sessionIndex] = {
            ...session,
            tokenUsage,
            updatedAt: Date.now(),
          }

          sessionService.setSessionsFor({ workspaceId: ws, sessions: updatedSessions })
          sessionService.saveCurrentSession() // Debounced

          // Broadcast usage update
          broadcastUsage()
        }
        break

      case 'done':
        // Flush any remaining content
        flush(key)
        break
    }
  })

  // Cleanup
  return () => {
    try {
      unsubscribe()
    } catch {}
  }
}


