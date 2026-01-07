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
import { badgeProcessor } from './badge-processor.js'

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

  if (process.env.HF_FLOW_DEBUG === '1') {
    console.log('[TimelineEventHandler] Starting listener:', { requestId, sessionId })
  }

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

    // Handle tokenUsage events - these are intermediate events during streaming
    // We push each event to the requestsLog so the UI can show all intermediate updates
    if (type === 'tokenUsage') {
      try {
        writer.updateUsage({
          usage: ev.usage,
          cost: ev.cost,
          provider: ev.provider,
          model: ev.model,
          requestId,
          nodeId: ev.nodeId || 'unknown',
          executionId: ev.executionId || 'unknown'
        })
      } catch (err) {
        if (process.env.HF_FLOW_DEBUG === '1') {
          console.error('[TimelineEventHandler] Failed to update usage for tokenUsage event:', err)
        }
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
          flush(key) // Immediate flush for tool start
        }
        break

      case 'toolEnd':
        // Update tool call with result and enrich with interactive data
        {
          const usageKeyForBuffer = `${ev.nodeId || 'global'}::${ev.executionId || 'global'}`
          const toolCalls = buffers.toolCalls.get(usageKeyForBuffer) || []

          const tool = toolCalls.find((t) => t.callId === ev.callId)
          if (tool) {
            tool.status = 'success'
            tool.result = ev.result
            tool.endTimestamp = Date.now()

            // Enrich badge with interactive data and content type based on tool
            // Use centralized badge processor instead of ad-hoc mutation
            const processedTool = badgeProcessor.processBadge(tool)

            // Update the tool in the buffer with the processed version
            const toolIndex = toolCalls.findIndex(t => t.callId === ev.callId)
            if (toolIndex >= 0) {
              toolCalls[toolIndex] = processedTool
            }

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

          // Note: We do NOT call updateUsage here because we already called it for each
          // individual tokenUsage event. The breakdown is just the sum of those events,
          // so calling updateUsage again would double-count the usage.

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
              inputTokens: usageData?.totals?.inputTokens,
              cachedTokens: usageData?.totals?.cachedTokens,
              outputTokens: usageData?.totals?.outputTokens,
              totalTokens: usageData?.totals?.totalTokens,
              inputCost: usageData?.cost?.inputCost,
              cachedCost: usageData?.cost?.cachedInputCost,
              outputCost: usageData?.cost?.outputCost,
              totalCost: usageData?.cost?.totalCost,
              currency: usageData?.cost?.currency
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

      case 'error':
        // Handle node/execution error
        if (ev.error) {
          writer.write(nodeId, executionId, {
            error: ev.error,
            boxId: buffers.openBoxIds.get(key),
          })
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


