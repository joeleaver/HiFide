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
import { flowEvents } from './events.js'
import { UiPayloadCache } from '../core/uiPayloadCache.js'
import { SessionTimelineWriter } from './session-timeline-writer.js'

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

  // Initialize writer
  const writer = new SessionTimelineWriter(sessionId, nodeMeta)

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

      const boxId = writer.write(nodeId, executionId, {
        text,
        reasoning,
        toolCalls,
        boxId: buffers.openBoxIds.get(key),
      })

      if (boxId) {
        buffers.openBoxIds.set(key, boxId)
      }

      // Clear text and reasoning buffers (but keep toolCalls until they complete)
      buffers.text.delete(key)
      buffers.reasoning.delete(key)
      // Don't clear toolCalls here - they need to persist until toolEnd/toolError
    } catch (error) {
      console.error('[TimelineEventHandler] flush() error:', error)
    }
  }

  // Event listener
  const unsubscribe = flowEvents.onFlowEvent(requestId, (ev: any) => {
    const { type, nodeId, executionId } = ev

    // Handle tokenUsage events (which may fire multiple times per stream) without
    // triggering session usage broadcasts. We'll rely on the final
    // usageBreakdown event (which we emit once per completed LLM call) to update
    // the session/renderer, so intermediate tokenUsage events are ignored to
    // prevent rerender storms.
    if (type === 'tokenUsage') {
      if (process.env.HF_FLOW_DEBUG === '1') {
        console.log('[TimelineEventHandler] tokenUsage event (ignored for UI)', {
          provider: ev.provider,
          model: ev.model,
          usage: ev.usage,
        })
      }
      return
    }
    // Other events require nodeId (except usageBreakdown which has recovery logic)
    if (!nodeId && type !== 'usageBreakdown') return
    if (!nodeId && type !== 'usageBreakdown') return

    let key = nodeId ? getKey(nodeId, executionId) : ''

    // Fallback: If executionId is missing, try to find active execution for this node
    if (!executionId && !buffers.openBoxIds.has(key)) {
      for (const k of buffers.openBoxIds.keys()) {
        if (k.startsWith(nodeId + '::')) {
          key = k
          // Extract executionId from key for consistency
          const parts = k.split('::')
          if (parts.length > 1) {
            ev.executionId = parts[1]
          }
          break
        }
      }
    }

    switch (type) {
      case 'nodeStart':
        // Ensure box is created immediately so subsequent events (like usage) 
        // can find the active execution even if they lack IDs
        flush(key)
        break

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
          // Recompute key with potentially recovered identifiers
          const usageKeyForBuffer = `${ev.nodeId || 'global'}::${ev.executionId || 'global'}`
          const toolCalls = buffers.toolCalls.get(usageKeyForBuffer) || []
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
          const usageKeyForBuffer = `${ev.nodeId || 'global'}::${ev.executionId || 'global'}`
          const toolCalls = buffers.toolCalls.get(usageKeyForBuffer) || []
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
          const usageKeyForBuffer = `${ev.nodeId || 'global'}::${ev.executionId || 'global'}`
          const toolCalls = buffers.toolCalls.get(usageKeyForBuffer) || []
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


      case 'usageBreakdown':
        // Handle usage breakdown event - create a badge
        {
          // Normalize payload property (scheduler emits 'breakdown', but internal logic expects 'usageBreakdown')
          const usageData = ev.breakdown || ev.usageBreakdown
          if (!usageData) {
            console.warn('[TimelineEventHandler] usageBreakdown event missing payload', ev)
            break
          }

          // Best-effort recovery of missing identifiers so the badge can still attach to
          // the correct box in the timeline.

          // 1) If executionId is missing but we know the node, infer it from open boxes
          if (!ev.executionId && ev.nodeId) {
            const found = Array.from(buffers.openBoxIds.entries()).find(([k]) => k.startsWith(ev.nodeId!))
            if (found) {
              // found[0] is the key (nodeId::executionId)
              const parts = found[0].split('::')
              if (parts.length > 1) {
                ev.executionId = parts[1]
              }
            }
          }

          // 2) If nodeId and/or executionId are still missing, try to borrow them from any open box
          // This indicates a scheduler/upstream bug where the event lost its context.
          if (!ev.nodeId || !ev.executionId) {
            console.warn('[TimelineEventHandler] usageBreakdown missing IDs - performing fallback recovery', { 
              nodeId: ev.nodeId, 
              executionId: ev.executionId,
              openBoxKeys: Array.from(buffers.openBoxIds.keys())
            })
            
            const anyKey = Array.from(buffers.openBoxIds.keys())[0]
            if (anyKey) {
              const [maybeNodeId, maybeExecId] = anyKey.split('::')
              if (!ev.nodeId && maybeNodeId) ev.nodeId = maybeNodeId
              if (!ev.executionId && maybeExecId) ev.executionId = maybeExecId
            }
          }

          const usageKey = `usage-${ev.executionId || Date.now()}`

          // Store breakdown data in cache for viewer
          UiPayloadCache.put(usageKey, usageData)
          
          // Also update session totals from the breakdown (since we suppress intermediate usage events)
          if (usageData.totals) {
            try {
              console.log('[TimelineEventHandler] Updating usage totals from breakdown:', {
                totals: usageData.totals,
                nodeId: ev.nodeId,
                executionId: ev.executionId
              })
              writer.updateUsage({
                usage: usageData.totals,
                provider: ev.provider,
                model: ev.model,
                requestId,
                nodeId: ev.nodeId || 'unknown',
                executionId: ev.executionId || 'unknown'
              })
            } catch (err) {
              console.error('[TimelineEventHandler] Failed to update usage totals:', err)
            }
          }

          const usageKeyForBuffer = `${ev.nodeId || 'global'}::${ev.executionId || 'global'}`
          const toolCalls = buffers.toolCalls.get(usageKeyForBuffer) || []

          // Create a badge for the usage breakdown
          const usageBadge = {
            id: `badge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            type: 'tool' as const, // Treat as tool for consistency in renderer
            toolName: 'usageBreakdown',
            label: 'Token Usage',
            callId: `usage-${ev.executionId}`,
            status: 'success' as const,
            timestamp: Date.now(),
            expandable: true,
            contentType: 'usage-breakdown' as const,
            interactive: {
              type: 'usage-breakdown',
              data: { key: usageKey }
            },
            metadata: {
              inputTokens: ev.usageBreakdown?.totals?.inputTokens,
              outputTokens: ev.usageBreakdown?.totals?.outputTokens,
              totalTokens: ev.usageBreakdown?.totals?.totalTokens
            }
          }

          toolCalls.push(usageBadge)
          buffers.toolCalls.set(usageKeyForBuffer, toolCalls)

          flush(usageKeyForBuffer)

          // Remove from buffer so we don't process it again (it's persisted in the box now)
          const updatedToolCalls = toolCalls.filter((t) => t.callId !== usageBadge.callId)
          if (updatedToolCalls.length > 0) {
            buffers.toolCalls.set(usageKeyForBuffer, updatedToolCalls)
          } else {
            buffers.toolCalls.delete(usageKeyForBuffer)
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
