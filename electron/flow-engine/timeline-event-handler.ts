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

/**
 * Format tool name for display (e.g., "fs_read_file" → "fs.read.file")
 */
function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, '.')
}

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

        // Update or append tool badges
        for (const tool of toolCalls) {
          // Find existing badge by callId
          const existingIndex = content.findIndex(
            (item: any) => item.type === 'badge' && item.badge?.callId === tool.callId
          )

          if (existingIndex >= 0) {
            // Update existing badge
            content[existingIndex] = { type: 'badge', badge: tool }
          } else {
            // Append new badge
            content.push({ type: 'badge', badge: tool })
          }
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
    // For text and reasoning, use appendToBox
    if (text || reasoning) {
      const delta = {
        op: 'appendToBox',
        nodeId,
        executionId,
        append: {
          text: text || undefined,
          reasoning: reasoning || undefined,
        },
      }
      broadcastWorkspaceNotification(ws, 'session.timeline.delta', delta)
    }

    // For badges, send individual updateBadge operations for each badge
    for (const badge of toolCalls) {
      const badgeDelta = {
        op: badge.status === 'running' ? 'appendToBox' : 'updateBadge',
        nodeId,
        executionId,
        callId: badge.callId,
        append: badge.status === 'running' ? { badges: [badge] } : undefined,
        updates: badge.status !== 'running' ? badge : undefined,
      }
      if (badge.status !== 'running') {
        console.log('[TimelineEventHandler] Broadcasting updateBadge:', {
          callId: badge.callId,
          label: badge.label,
          hasInteractive: !!badge.interactive,
          interactiveType: badge.interactive?.type,
          interactiveKey: badge.interactive?.data?.key,
          badgeKeys: Object.keys(badge),
          updatesHasInteractive: !!(badgeDelta.updates as any)?.interactive,
          fullInteractive: JSON.stringify(badge.interactive),
          fullBadge: JSON.stringify(badge)
        })
      }
      broadcastWorkspaceNotification(ws, 'session.timeline.delta', badgeDelta)
    }

      // Clear text and reasoning buffers (but keep toolCalls until they complete)
      buffers.text.delete(key)
      buffers.reasoning.delete(key)
      // Don't clear toolCalls here - they need to persist until toolEnd/toolError
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

      console.log('[TimelineEventHandler.broadcastUsage] Broadcasting:', { tokenUsage, costs, requestsLog })
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

    // Handle tokenUsage events (which don't have nodeId) separately
    if (type === 'tokenUsage') {
      console.log('[TimelineEventHandler] tokenUsage event RECEIVED:', ev)

      if (!sessionService || !workspaceService) {
        console.log('[TimelineEventHandler] tokenUsage: MISSING SERVICES', {
        hasSessionService: !!sessionService,
        hasWorkspaceService: !!workspaceService
      })
      return
    }
    
    const sessionService = ServiceRegistry.getInstance().get<any>('session')
    const workspaceService = ServiceRegistry.getInstance().get<any>('workspace')'workspace')
        if (!sessionService || !workspaceService) {
          console.log('[TimelineEventHandler] tokenUsage: missing service')
          return
        }

        const ws = workspaceService.getWorkspaceRoot()
        console.log('[TimelineEventHandler] tokenUsage: workspace root:', ws)
        if (!ws) {
          console.log('[TimelineEventHandler] tokenUsage: no workspace root, returning')
          return
        }

        const sessions = sessionService.getSessionsFor({ workspaceId: ws })
        console.log('[TimelineEventHandler] tokenUsage: found sessions:', sessions.length, 'looking for:', sessionId)
        const sessionIndex = sessions.findIndex((s: any) => s.id === sessionId)
        console.log('[TimelineEventHandler] tokenUsage: sessionIndex:', sessionIndex)
        if (sessionIndex === -1) {
          console.log('[TimelineEventHandler] tokenUsage: session not found, returning')
          return
        }

        const session = sessions[sessionIndex]
        console.log('[TimelineEventHandler] Session tokenUsage BEFORE:', session.tokenUsage)
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

        console.log('[TimelineEventHandler] Session tokenUsage AFTER accumulation:', tokenUsage)
        sessionService.setSessionsFor({ workspaceId: ws, sessions: updatedSessions })
        sessionService.saveCurrentSession() // Debounced

        // Broadcast usage update
        console.log('[TimelineEventHandler] Calling broadcastUsage()')
        broadcastUsage()
      }
      return
    }

    // Other events require nodeId
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
          const toolName = ev.toolName || 'unknown'
          const label = formatToolName(toolName)

          console.log('[TimelineEventHandler] toolStart:', {
            callId: ev.callId,
            toolName,
            label
          })

          toolCalls.push({
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            type: 'tool' as const,
            toolName,
            label,
            callId: ev.callId,
            args: ev.toolArgs,
            status: 'running' as const,
            timestamp: Date.now(),
            expandable: false, // Will be set by enrichBadgeWithToolData
            contentType: 'json' as const,
          })
          buffers.toolCalls.set(key, toolCalls)
          console.log('[TimelineEventHandler] Added to buffer, total tools:', toolCalls.length)
          flush(key) // Immediate flush for tool start
        }
        break

      case 'toolEnd':
        // Update tool call with result and enrich with interactive data
        {
          const toolCalls = buffers.toolCalls.get(key) || []
          console.log('[TimelineEventHandler] toolEnd:', {
            callId: ev.callId,
            toolName: ev.toolName,
            bufferedToolsCount: toolCalls.length,
            bufferedCallIds: toolCalls.map(t => t.callId)
          })

          const tool = toolCalls.find((t) => t.callId === ev.callId)
          if (tool) {
            console.log('[TimelineEventHandler] Found tool in buffer, updating status to success')
            tool.status = 'success'
            tool.result = ev.result
            tool.endTimestamp = Date.now()

            // Enrich badge with interactive data and content type based on tool
            enrichBadgeWithToolData(tool, ev.result)
            console.log('[TimelineEventHandler] After enrichment:', {
              contentType: tool.contentType,
              hasInteractive: !!tool.interactive,
              label: tool.label
            })

            flush(key) // Immediate flush for tool end

            // Remove this specific tool from buffer (keep others that might still be running)
            const updatedToolCalls = toolCalls.filter((t) => t.callId !== ev.callId)
            if (updatedToolCalls.length > 0) {
              buffers.toolCalls.set(key, updatedToolCalls)
            } else {
              buffers.toolCalls.delete(key)
            }
          } else {
            console.warn('[TimelineEventHandler] Tool not found in buffer!', { callId: ev.callId })
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

            // Remove this specific tool from buffer (keep others that might still be running)
            const updatedToolCalls = toolCalls.filter((t) => t.callId !== ev.callId)
            if (updatedToolCalls.length > 0) {
              buffers.toolCalls.set(key, updatedToolCalls)
            } else {
              buffers.toolCalls.delete(key)
            }
          }
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

/**
 * Enrich badge with interactive data and metadata based on tool result
 * This determines what content viewer to use when the badge is expanded
 *
 * Note: result is the MINIMAL result (after toModelResult transformation)
 * because provider adapters call toModelResult and return minimal to the LLM
 */
function enrichBadgeWithToolData(badge: any, result: any) {
  const toolName = badge.toolName || ''

  // Extract previewKey from result (it's in the minimal result, not nested)
  const previewKey = result?.previewKey

  // edits.apply - diff viewer
  if (toolName === 'applyEdits' || toolName === 'edits.apply' || toolName === 'editsApply') {
    badge.contentType = 'diff'
    badge.expandable = true // Always expandable - shows diffs
    if (previewKey) {
      const interactiveData = { key: previewKey }
      badge.interactive = {
        type: 'diff',
        data: interactiveData
      }
      console.log('[enrichBadgeWithToolData] Set interactive for applyEdits:', {
        previewKey,
        interactiveData,
        interactive: badge.interactive,
        dataType: typeof badge.interactive.data,
        dataKeys: Object.keys(badge.interactive.data)
      })
    }
    // Add file count metadata from minimal result
    const fileCount = result?.previewCount
    if (fileCount) {
      badge.metadata = { ...badge.metadata, fileCount }
      // Enhance label with file count or file name
      if (fileCount === 1) {
        // Try to get the file name from the result
        const fileName = result?.files?.[0]?.path?.split(/[/\\]/).pop()
        if (fileName) {
          // Try to get line numbers if available
          const edit = result?.files?.[0]
          if (edit?.startLine !== undefined && edit?.endLine !== undefined) {
            badge.label = `Apply Edits: ${fileName} (lines ${edit.startLine}-${edit.endLine})`
          } else {
            badge.label = `Apply Edits: ${fileName}`
          }
        } else {
          badge.label = `Apply Edits (1 file)`
        }
      } else {
        badge.label = `Apply Edits (${fileCount} files)`
      }
    } else {
      // Fallback: no file count in result, just use generic label
      badge.label = 'Apply Edits'
    }
    // Add line change counts if available
    if (result?.addedLines) badge.addedLines = result.addedLines
    if (result?.removedLines) badge.removedLines = result.removedLines
  }

  // fs.read_lines - code viewer
  else if (toolName === 'fsReadLines' || toolName === 'fs.read_lines') {
    badge.contentType = 'read-lines'
    badge.expandable = true // Always expandable - shows code
    if (previewKey) {
      badge.interactive = {
        type: 'read-lines',
        data: { key: previewKey }
      }
    }
    // Add file path and line range metadata from args
    const filePath = badge.args?.path
    const startLine = badge.args?.start_line
    const endLine = badge.args?.end_line
    if (filePath) {
      badge.metadata = { ...badge.metadata, filePath }
      // Enhance label with file name and line range
      const fileName = filePath.split(/[/\\]/).pop()
      if (fileName) {
        let label = `${fileName}`
        if (startLine !== undefined && endLine !== undefined) {
          label += ` (lines ${startLine}-${endLine})`
        } else if (startLine !== undefined) {
          label += ` (from line ${startLine})`
        }
        badge.label = label
      }
    }
  }

  // fs.read_file - file read
  else if (toolName === 'fsReadFile' || toolName === 'fs.read_file') {
    badge.contentType = 'json'
    badge.expandable = false
    const filePath = badge.args?.path
    if (filePath) {
      badge.metadata = { ...badge.metadata, filePath }
      const fileName = filePath.split(/[/\\]/).pop()
      if (fileName) {
        badge.label = `Read File: ${fileName}`
      }
    }
  }

  // fs.write_file - file write
  else if (toolName === 'fsWriteFile' || toolName === 'fs.write_file') {
    badge.contentType = 'json'
    badge.expandable = false
    const filePath = badge.args?.path
    if (filePath) {
      badge.metadata = { ...badge.metadata, filePath }
      const fileName = filePath.split(/[/\\]/).pop()
      if (fileName) {
        badge.label = `Write File: ${fileName}`
      }
    }
  }

  // fs.delete_file - file delete
  else if (toolName === 'fsDeleteFile' || toolName === 'fs.delete_file') {
    badge.contentType = 'json'
    badge.expandable = false
    const filePath = badge.args?.path
    if (filePath) {
      badge.metadata = { ...badge.metadata, filePath }
      const fileName = filePath.split(/[/\\]/).pop()
      if (fileName) {
        badge.label = `Delete File: ${fileName}`
      }
    }
  }

  // fs.exists - file exists check
  else if (toolName === 'fsExists' || toolName === 'fs.exists') {
    badge.contentType = 'json'
    badge.expandable = false
    const filePath = badge.args?.path
    if (filePath) {
      badge.metadata = { ...badge.metadata, filePath }
      const fileName = filePath.split(/[/\\]/).pop()
      if (fileName) {
        badge.label = `Check File: ${fileName}`
      }
    }
  }

  // fs.create_dir - directory creation
  else if (toolName === 'fsCreateDir' || toolName === 'fs.create_dir') {
    badge.contentType = 'json'
    badge.expandable = false
    const dirPath = badge.args?.path
    if (dirPath) {
      badge.metadata = { ...badge.metadata, dirPath }
      const dirName = dirPath.split(/[/\\]/).pop()
      if (dirName) {
        badge.label = `Create Folder: ${dirName}`
      }
    }
  }

  // workspace.search - workspace search viewer
  else if (toolName === 'workspaceSearch' || toolName === 'workspace.search' || toolName === 'searchWorkspace') {
    badge.contentType = 'workspace-search'
    // Add result count metadata from minimal result
    const resultCount = result?.resultCount || result?.count
    const query = badge.args?.query

    // Only expandable if there are results
    badge.expandable = resultCount > 0

    if (previewKey) {
      badge.interactive = {
        type: 'workspace-search',
        data: { key: previewKey }
      }
    }

    // Enhance label with query and result count
    if (query) {
      badge.metadata = { ...badge.metadata, query }
      const queryPreview = query.length > 40 ? `${query.substring(0, 40)}...` : query
      if (resultCount !== undefined) {
        badge.metadata = { ...badge.metadata, resultCount }
        badge.label = `Search Workspace: "${queryPreview}" (${resultCount} result${resultCount === 1 ? '' : 's'})`
      } else {
        badge.label = `Search Workspace: "${queryPreview}"`
      }
    } else if (resultCount !== undefined) {
      badge.metadata = { ...badge.metadata, resultCount }
      badge.label = `Search Workspace (${resultCount} result${resultCount === 1 ? '' : 's'})`
    }
  }

  // workspace.map - workspace map viewer
  else if (toolName === 'workspaceMap' || toolName === 'workspace.map') {
    badge.contentType = 'workspace-map'
    badge.expandable = true // Always expandable - shows file tree
    if (previewKey) {
      badge.interactive = {
        type: 'workspace-map',
        data: { key: previewKey }
      }
    }
  }

  // knowledgeBase.search - KB search viewer
  else if (toolName === 'knowledgeBaseSearch' || toolName === 'knowledgeBase.search' || toolName === 'kbSearch') {
    badge.contentType = 'kb-search'
    // Add result count metadata from minimal result
    const resultCount = result?.resultCount || result?.count
    const query = badge.args?.query

    // Only expandable if there are results
    badge.expandable = resultCount > 0

    if (previewKey) {
      badge.interactive = {
        type: 'kb-search',
        data: { key: previewKey }
      }
    }

    // Enhance label with query and result count
    if (query) {
      badge.metadata = { ...badge.metadata, query }
      const queryPreview = query.length > 40 ? `${query.substring(0, 40)}...` : query
      if (resultCount !== undefined) {
        badge.metadata = { ...badge.metadata, resultCount }
        badge.label = `Search KB: "${queryPreview}" (${resultCount} result${resultCount === 1 ? '' : 's'})`
      } else {
        badge.label = `Search KB: "${queryPreview}"`
      }
    } else if (resultCount !== undefined) {
      badge.metadata = { ...badge.metadata, resultCount }
      badge.label = `Search KB (${resultCount} result${resultCount === 1 ? '' : 's'})`
    }
  }

  // knowledgeBase.store - KB store viewer
  else if (toolName === 'knowledgeBaseStore' || toolName === 'knowledgeBase.store' || toolName === 'kbStore') {
    badge.contentType = 'kb-store'
    badge.expandable = true // Always expandable - shows stored entries
    if (previewKey) {
      badge.interactive = {
        type: 'kb-store',
        data: { key: previewKey }
      }
    }

    // Enhance label with action and title
    const action = result?.action // 'Created' or 'Updated'
    const title = result?.title || badge.args?.title
    if (action && title) {
      const titlePreview = title.length > 40 ? `${title.substring(0, 40)}...` : title
      badge.label = `${action} KB Entry: "${titlePreview}"`
    } else if (title) {
      const titlePreview = title.length > 40 ? `${title.substring(0, 40)}...` : title
      badge.label = `Store KB Entry: "${titlePreview}"`
    } else {
      badge.label = 'Store KB Entry'
    }
  }

  // agent.assess - agent assess viewer
  else if (toolName === 'agentAssessTask' || toolName === 'agent.assess' || toolName === 'assessTask') {
    badge.contentType = 'agent-assess'
    badge.expandable = true // Always expandable - shows assessment
    if (previewKey) {
      badge.interactive = {
        type: 'agent-assess',
        data: { key: previewKey }
      }
    }
  }

  // kanban.createTask - task creation
  else if (toolName === 'kanbanCreateTask' || toolName === 'kanban.createTask') {
    badge.contentType = 'json'
    badge.expandable = false
    const title = badge.args?.title
    if (title) {
      badge.metadata = { ...badge.metadata, title }
      const titlePreview = title.length > 40 ? `${title.substring(0, 40)}...` : title
      badge.label = `Create Task: "${titlePreview}"`
    }
  }

  // kanban.moveTask - task move
  else if (toolName === 'kanbanMoveTask' || toolName === 'kanban.moveTask') {
    badge.contentType = 'json'
    badge.expandable = false
    const status = badge.args?.status
    if (status) {
      // Convert camelCase status to readable format
      const statusMap: Record<string, string> = {
        'backlog': 'Backlog',
        'todo': 'To Do',
        'inProgress': 'In Progress',
        'done': 'Done'
      }
      badge.label = `Move Task to ${statusMap[status] || status}`
    }
  }

  // kanban.updateTask - task update
  else if (toolName === 'kanbanUpdateTask' || toolName === 'kanban.updateTask') {
    badge.contentType = 'json'
    badge.expandable = false
    const title = badge.args?.title
    if (title) {
      const titlePreview = title.length > 30 ? `${title.substring(0, 30)}...` : title
      badge.label = `Update: "${titlePreview}"`
    } else {
      badge.label = 'Update task'
    }
  }

  // kanban.getBoard - get board
  else if (toolName === 'kanbanGetBoard' || toolName === 'kanban.getBoard') {
    badge.contentType = 'json'
    badge.expandable = false
    badge.label = 'Read Kanban Board'
  }

  // terminal.exec - terminal command
  else if (toolName === 'terminalExec' || toolName === 'terminal.exec') {
    badge.contentType = 'json'
    badge.expandable = false
    const command = badge.args?.command
    if (command) {
      badge.metadata = { ...badge.metadata, command }
      const cmdPreview = command.length > 40 ? `${command.substring(0, 40)}...` : command
      badge.label = `$ ${cmdPreview}`
    }
  }

  // Default: not expandable unless it has error
  else {
    badge.contentType = 'json'
    badge.expandable = false // Most tools don't need expansion
    if (previewKey) {
      badge.interactive = {
        type: 'action',
        data: { key: previewKey }
      }
    }
  }

  // Always make errors expandable
  if (badge.status === 'error') {
    badge.expandable = true
  }
}
