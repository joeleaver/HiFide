import { Stack, Card, ScrollArea, Text, Badge as MantineBadge, Skeleton } from '@mantine/core'

// zubridge removed from session pane reads
// import { useAppStore, useDispatch, selectCurrentId, selectCurrentSession } from './store'
import { useUiStore } from './store/ui'
import Markdown from './components/Markdown'
// Debug flag for render logging
const DEBUG_RENDERS = true


import DiffPreviewModal from './components/DiffPreviewModal'
import { InlineBadgeDiff } from './components/InlineBadgeDiff'
import ToolBadgeContainer from './components/ToolBadgeContainer'
import { BadgeDiffContent } from './components/BadgeDiffContent'
import { BadgeSearchContent } from './components/BadgeSearchContent'
import { BadgeWorkspaceSearchContent } from './components/BadgeWorkspaceSearchContent'
import { BadgeKnowledgeBaseSearchContent } from './components/BadgeKnowledgeBaseSearchContent'
import { BadgeKnowledgeBaseStoreContent } from './components/BadgeKnowledgeBaseStoreContent'
import { BadgeAstSearchContent } from './components/BadgeAstSearchContent'
import { BadgeReadLinesContent } from './components/BadgeReadLinesContent'
import { BadgeWorkspaceJumpContent } from './components/BadgeWorkspaceJumpContent'
import { BadgeWorkspaceMapContent } from './components/BadgeWorkspaceMapContent'
import { useChatTimeline } from './store/chatTimeline'
import { getBackendClient } from './lib/backend/bootstrap'


import { BadgeAgentAssessTaskContent } from './components/BadgeAgentAssessTaskContent'

import { useFlowRuntime } from './store/flowRuntime'
import { BadgeUsageBreakdownContent } from './components/BadgeUsageBreakdownContent'

import { NodeOutputBox } from './components/NodeOutputBox'

import type { NodeExecutionBox } from '../electron/store/types'
import { useRef, useEffect, useMemo, Fragment } from 'react'

import SessionControlsBar from './components/SessionControlsBar'


import classes from './SessionPane.module.css'

function SessionPane() {

  // Read session timeline exclusively from renderer store fed by WS deltas (no zubridge reads)
  const itemsSig = useChatTimeline((s) => s.sig)
  const sessionItems = useChatTimeline((s) => s.items)

  const isHydratingTimeline = useChatTimeline((s) => s.isHydrating)
  const hasRenderedOnce = useChatTimeline((s) => s.hasRenderedOnce)
  const hydrationVersion = useChatTimeline((s) => s.hydrationVersion || 0)

  // Mount log
  useEffect(() => {
    console.log('[SessionPane] Component mounted')
    return () => console.log('[SessionPane] Component unmounted')
  }, [])

  // Mark the timeline as "rendered once" once we've seen at least one
  // snapshot (hydrationVersion > 0) and finished hydrating. This covers both
  // cases where the snapshot arrived before SessionPane mounted (first window)
  // and cases where it arrives later.
  // Also includes a fallback timeout to prevent getting stuck if hydration never completes.
  useEffect(() => {
    if (!hasRenderedOnce && hydrationVersion > 0 && !isHydratingTimeline) {
      console.log('[SessionPane] Setting hasRenderedOnce = true (hydration complete)')
      try { useChatTimeline.setState({ hasRenderedOnce: true }) } catch { }
    }
  }, [hydrationVersion, isHydratingTimeline, hasRenderedOnce])

  // Fallback: if we're mounted but hasRenderedOnce is still false after 3s, force it
  useEffect(() => {
    if (hasRenderedOnce) return

    const fallbackTimeout = setTimeout(() => {
      const state: any = useChatTimeline.getState()
      if (!state.hasRenderedOnce) {
        console.warn('[SessionPane] Fallback: forcing hasRenderedOnce = true after timeout')
        try { useChatTimeline.setState({ hasRenderedOnce: true, isHydrating: false }) } catch { }
      }
    }, 3000)

    return () => clearTimeout(fallbackTimeout)
  }, [hasRenderedOnce])

  // Flow execution state - now driven by renderer-side flowRuntime store (WebSocket events)
  const feStatus = useFlowRuntime((s) => s.status)


  // Render diagnostics
  const renderCountRef = useRef(0)
  const lastRenderTs = useRef(performance.now())
  renderCountRef.current += 1
  if (DEBUG_RENDERS) {
    lastRenderTs.current = performance.now()
  }

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  // Track previous selected values to identify change sources between renders
  const prev = useRef<{ sig: any; fe: any; auto: any }>({ sig: undefined, fe: undefined, auto: undefined })
  const changed: string[] = []
  if (prev.current.sig !== itemsSig) changed.push('itemsSig')
  if (prev.current.fe !== feStatus) changed.push('feStatus')
  const autoNow = useUiStore((s) => s.shouldAutoScroll)
  if (prev.current.auto !== autoNow) changed.push('shouldAutoScroll')
  prev.current = { sig: itemsSig, fe: feStatus, auto: autoNow }

  if (DEBUG_RENDERS) {
    // Detailed debug logging removed to reduce console noise
  }

  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useUiStore((s) => s.shouldAutoScroll)
  const setShouldAutoScroll = useUiStore((s) => s.setShouldAutoScroll)

  // Check if user is near bottom (within 150px threshold)
  const checkIfNearBottom = () => {
    const viewport = viewportRef.current
    if (!viewport) return true

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    // Consider "near bottom" if within 150px or already at bottom (accounting for rounding)

    return distanceFromBottom < 150
  }


  // Update shouldAutoScroll when user manually scrolls
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = () => {
      const isNearBottom = checkIfNearBottom()
      const current = useUiStore.getState().shouldAutoScroll
      if (current !== isNearBottom) setShouldAutoScroll(isNearBottom)
    }

    // Set initial state (guarded)
    {
      const initial = checkIfNearBottom()
      const current = useUiStore.getState().shouldAutoScroll
      if (current !== initial) setShouldAutoScroll(initial)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [setShouldAutoScroll])

  // Auto-scroll when session items/streaming changes, but only if user is near bottom
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    // Check if we should auto-scroll
    if (!shouldAutoScroll) return

    // Use requestAnimationFrame to ensure DOM has updated before scrolling
    requestAnimationFrame(() => {
      if (viewport && shouldAutoScroll) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
  }, [sessionItems, shouldAutoScroll]) // Trigger on ANY sessionItems change, not just length

  // Memoize the expensive rendering of session items
  // Only re-render when sessionItems actually changes
  const renderedItems = useMemo(() => {
    return sessionItems.map((item: any) => {
      // User message
      if (item.type === 'message' && item.role === 'user') {
        return (
          <Card
            key={item.id}
            withBorder
            p="xs"
            className={classes.userMessageCard}
          >
            <Markdown content={item.content || ''} />
          </Card>
        )
      }

      // Node execution box
      if (item.type === 'node-execution') {
        const box = item as NodeExecutionBox

        // Merge consecutive text items to fix markdown rendering
        // (debounced flushing can split markdown syntax across multiple text items)
        const mergedContent: Array<{ type: 'text'; text: string } | { type: 'reasoning'; text: string } | { type: 'badge'; badge: any }> = []
        let textBuffer = ''
        let reasoningBuffer = ''

        for (const contentItem of box.content) {
          if (contentItem.type === 'text') {
            // Flush reasoning first, then accumulate text
            if (reasoningBuffer) {
              mergedContent.push({ type: 'reasoning', text: reasoningBuffer })
              reasoningBuffer = ''
            }
            textBuffer += contentItem.text
          } else if (contentItem.type === 'reasoning') {
            // Flush text first, then accumulate reasoning (merge consecutive reasoning chunks)
            if (textBuffer) {
              mergedContent.push({ type: 'text', text: textBuffer })
              textBuffer = ''
            }
            reasoningBuffer += contentItem.text
          } else {
            // Non-text item (badge) - flush both buffers
            if (reasoningBuffer) {
              mergedContent.push({ type: 'reasoning', text: reasoningBuffer })
              reasoningBuffer = ''
            }
            if (textBuffer) {
              mergedContent.push({ type: 'text', text: textBuffer })
              textBuffer = ''
            }
            mergedContent.push(contentItem)
          }
        }

        // Flush any remaining buffers
        if (reasoningBuffer) {
          mergedContent.push({ type: 'reasoning', text: reasoningBuffer })
        }
        if (textBuffer) {
          mergedContent.push({ type: 'text', text: textBuffer })
        }

        return (
          <NodeOutputBox
            key={box.id}
            nodeLabel={box.nodeLabel}
            nodeType={box.nodeKind}
            provider={box.provider}
            model={box.model}
            cost={box.cost}
          >
            <Stack gap="xs">
              {mergedContent.map((contentItem, idx) => {
                if (contentItem.type === 'text') {
                  return <Markdown key={idx} content={contentItem.text} />
                }
                if (contentItem.type === 'reasoning') {
                  const trimmed = (contentItem.text || '').replace(/\s+$/, '')
                  return (
                    <div
                      key={idx}
                      className={classes.reasoningBlock}
                    >
                      <Text c="gray.5" className={classes.quoteIconLeft}>“</Text>
                      <Text c="gray.5" className={classes.quoteIconRight}>”</Text>
                      <Text className={classes.reasoningText}>{trimmed}</Text>
                    </div>
                  )
                }
                if (contentItem.type === 'badge') {
                  const badge = contentItem.badge

                  // Use ToolBadgeContainer for tool and error badges (widgets)
                  // This ensures consistent rendering and expand/collapse behavior
                  if (badge.type === 'tool' || badge.type === 'error') {
                    return (
                      <ToolBadgeContainer key={`badge-${badge.id}`} badge={badge}>
                        {badge.contentType === 'diff' && badge.interactive?.data?.key && (
                          <BadgeDiffContent badgeId={badge.id} diffKey={badge.interactive.data.key} />
                        )}
                        {badge.contentType === 'search' && badge.interactive?.data?.key && (
                          <BadgeSearchContent
                            badgeId={badge.id}
                            searchKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                          />
                        )}
                        {badge.contentType === 'workspace-search' && badge.interactive?.data?.key && (
                          <BadgeWorkspaceSearchContent
                            badgeId={badge.id}
                            searchKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                            previewKey={(badge as any)?.interactive?.data?.previewKey}
                          />
                        )}
                        {badge.contentType === 'workspace-jump' && badge.interactive?.data?.key && (
                          <BadgeWorkspaceJumpContent
                            badgeId={badge.id}
                            searchKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                          />
                        )}
                        {badge.contentType === 'workspace-map' && badge.interactive?.data?.key && (
                          <BadgeWorkspaceMapContent
                            badgeId={badge.id}
                            searchKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                          />
                        )}
                        {badge.contentType === 'ast-search' && badge.interactive?.data?.key && (
                          <BadgeAstSearchContent
                            badgeId={badge.id}
                            searchKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                          />
                        )}
                        {badge.contentType === 'read-lines' && badge.interactive?.data?.key && (
                          <BadgeReadLinesContent
                            badgeId={badge.id}
                            readKey={badge.interactive.data.key}
                          />
                        )}
                        {badge.contentType === 'kb-search' && badge.interactive?.data?.key && (
                          <BadgeKnowledgeBaseSearchContent
                            badgeId={badge.id}
                            searchKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                          />
                        )}
                        {badge.contentType === 'kb-store' && badge.interactive?.data?.key && (
                          <BadgeKnowledgeBaseStoreContent
                            badgeId={badge.id}
                            resultKey={badge.interactive.data.key}
                            fullParams={badge.metadata?.fullParams}
                          />
                        )}
                        {badge.contentType === 'agent-assess' && badge.interactive?.data?.key && (
                          <BadgeAgentAssessTaskContent
                            badgeId={badge.id}
                            assessKey={badge.interactive.data.key}
                          />
                        )}
                        {badge.contentType === 'usage-breakdown' && badge.interactive?.data?.key && (
                          <BadgeUsageBreakdownContent
                            badgeId={badge.id}
                            usageKey={badge.interactive.data.key}
                          />
                        )}
                        {badge.type === 'error' && (
                          <Text size="xs" c="red.4" className={classes.errorText}>
                            {badge.error || ''}
                          </Text>
                        )}
                      </ToolBadgeContainer>
                    )
                  }

                  // Legacy simple badge rendering for non-tool badges
                  return (
                    <Fragment key={`badge-${badge.id}`}>
                      <MantineBadge
                        key={idx}
                        color={badge.color || 'gray'}
                        variant={badge.variant || 'light'}
                        size="sm"
                        leftSection={badge.icon}
                        tt="none"
                        style={{
                          opacity: badge.status === 'running' ? 0.7 : 1,
                          cursor: badge.interactive?.type === 'diff' ? 'pointer' as const : 'default',
                        }}
                        onClick={badge.interactive?.type === 'diff' ? async () => {
                          const ui = useUiStore.getState()
                          const payload = badge.interactive.data
                          const state = useUiStore.getState()
                          const isOpen = !!state.inlineDiffOpenByBadge?.[badge.id]
                          const existing = state.inlineDiffByBadge?.[badge.id]
                          if (isOpen) {
                            ui.closeInlineDiffForBadge(badge.id)
                            return
                          }
                          if (Array.isArray(payload)) {
                            // Set data cache and open
                            ui.openInlineDiffForBadge(badge.id, payload)
                          } else if (payload && typeof payload === 'object' && payload.key) {
                            try {
                              // If we already have cached data, just open it
                              if (existing && existing.length) {
                                ui.openInlineDiffForBadge(badge.id, existing)
                                return
                              }
                              const client = getBackendClient()
                              if (client) {
                                const res: any = await client.rpc('edits.preview', { key: payload.key })
                                const files = Array.isArray(res?.data) ? res.data : []
                                if (files.length) ui.openInlineDiffForBadge(badge.id, files)
                              }
                            } catch (e) {
                              // Swallow diff preview errors; badge remains clickable for full modal
                            }
                          }
                        } : undefined}
                      >
                        <span className={classes.badgeLabel}>
                          <span>
                            {badge.label}
                            {badge.status === 'running' && ' ...'}
                            {badge.status === 'error' && ' ✗'}
                          </span>
                          {typeof badge.addedLines === 'number' && (
                            <span className={classes.addedLines}>+{badge.addedLines}</span>
                          )}
                          {typeof badge.removedLines === 'number' && (
                            <span className={classes.removedLines}>-{badge.removedLines}</span>
                          )}
                        </span>
                      </MantineBadge>
                      <InlineBadgeDiff badgeId={badge.id} />
                    </Fragment>
                  )
                }
                return null
              })}
            </Stack>
          </NodeOutputBox>
        )
      }

      return null
    })
  }, [sessionItems]) // Only re-render when sessionItems changes

  return (
    <Stack
      gap="md"

      className={classes.container}

    >
      <DiffPreviewModal />

      {/* Messages Area - takes remaining space */}
      <ScrollArea
        className={classes.scrollArea}
        scrollbars="y"
        type="auto"
        viewportRef={viewportRef}
      >
        <Stack gap="sm" pr="md">
          {/* Simplified session timeline rendering */}
          {isHydratingTimeline ? (
            <>
              <Skeleton height={26} radius="sm" />
              <Skeleton height={110} radius="sm" />
              <Skeleton height={26} radius="sm" />
            </>
          ) : (
            renderedItems
          )}

        </Stack>
      </ScrollArea>

      {/* Controls Bar (now includes input + focus) */}
      <SessionControlsBar />
    </Stack>

  )
}



export default SessionPane
