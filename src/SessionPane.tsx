import { Stack, Textarea, Card, ScrollArea, Text, Badge as MantineBadge, useMantineTheme, Group, ActionIcon, Tooltip } from '@mantine/core'
import { DiffEditor } from '@monaco-editor/react'
import { IconArrowsMaximize, IconX } from '@tabler/icons-react'
import { useAppStore, useDispatch, selectCurrentId } from './store'
import { useUiStore } from './store/ui'
import Markdown from './components/Markdown'
// Debug flag for render logging
const DEBUG_RENDERS = true


import DiffPreviewModal from './components/DiffPreviewModal'
import ToolBadgeContainer from './components/ToolBadgeContainer'
import { BadgeDiffContent } from './components/BadgeDiffContent'
import { BadgeSearchContent } from './components/BadgeSearchContent'
import { BadgeWorkspaceSearchContent } from './components/BadgeWorkspaceSearchContent'
import { BadgeAstSearchContent } from './components/BadgeAstSearchContent'
import { BadgeReadLinesContent } from './components/BadgeReadLinesContent'

import { NodeOutputBox } from './components/NodeOutputBox'
import { FlowStatusIndicator } from './components/FlowStatusIndicator'
import type { NodeExecutionBox } from '../electron/store/types'
import { useRef, useEffect, useMemo, memo, Fragment } from 'react'

// Separate input component to prevent re-renders when parent updates
const SessionInput = memo(function SessionInput() {
  const dispatch = useDispatch()
  const inputValue = useUiStore((s) => s.sessionInputValue || '')
  const setInputValue = useUiStore((s) => s.setSessionInputValue)

  const send = async () => {
    const text = inputValue.trim()
    if (!text) return

    // Clear input and resume flow
    setInputValue('')
    await dispatch('feResume', { userInput: text })
  }

  return (
    <Textarea
      placeholder="Ask your agent... (Ctrl+Enter to send)"
      autosize
      minRows={2}
      maxRows={6}
      value={inputValue}
      onChange={(e) => setInputValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          send()
        }
      }}
      styles={{
        input: {
          backgroundColor: '#252526',
          border: '1px solid #3e3e42',
        },
      }}
    />

  )
})

function SessionPane() {
  const theme = useMantineTheme()
  const currentId = useAppStore(selectCurrentId)

  // Subscribe to a minimal signature of the items to avoid re-renders on reference churn
  const itemsSig = useAppStore((s) => {
    const currentSession = s.sessions.find((sess: any) => sess.id === currentId)
    const items = currentSession?.items || []
    const len = items.length
    if (!len) return '0'
    const last = items[len - 1]
    const contentLen = Array.isArray(last.content) ? last.content.length : 0
    const lastContent = contentLen ? last.content[contentLen - 1] : undefined
    if (!lastContent) return `${len}:${last.id}:${last.type}:none`
    if ((lastContent as any).type === 'text') {
      return `${len}:${last.id}:${last.type}:text:${(lastContent as any).text?.length ?? 0}`
    }
    if ((lastContent as any).type === 'badge') {
      const b = (lastContent as any).badge || {}
      return `${len}:${last.id}:${last.type}:badge:${b.status || ''}:${b.addedLines ?? ''}:${b.removedLines ?? ''}:${b.label || ''}`
    }
    return `${len}:${last.id}:${last.type}:${(lastContent as any).type || 'other'}`
  })

  // Read full items non-subscribed, keyed by signature changes
  const sessionItems = useMemo(() => {
    const st = useAppStore.getState()
    const currentSession = st.sessions.find((sess: any) => sess.id === currentId)
    return currentSession?.items || []
  }, [itemsSig, currentId])

  // Flow execution state - these DO cause re-renders when they change
  const feStatus = useAppStore((s) => s.feStatus)

  // Render diagnostics
  const renderCountRef = useRef(0)
  const lastRenderTs = useRef(performance.now())
  renderCountRef.current += 1
  if (DEBUG_RENDERS) {
    const now = performance.now()
    const delta = now - lastRenderTs.current
    lastRenderTs.current = now
    const len = sessionItems.length
    const last = len ? sessionItems[len - 1] : null
    const lastSummary = last ? `${last.type}:${last.id}:${Array.isArray(last.content) ? last.content.length : 0}` : 'none'
    // eslint-disable-next-line no-console
    console.log(`[SessionPane] render #${renderCountRef.current} t=${(now / 1000).toFixed(3)}s Δ=${delta.toFixed(0)}ms items=${len} last=${lastSummary} feStatus=${feStatus}`)
  }

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  // Track previous selected values to identify change sources between renders
  const prev = useRef<{ id: any; sig: any; fe: any; auto: any }>({ id: undefined, sig: undefined, fe: undefined, auto: undefined })
  const changed: string[] = []
  if (prev.current.id !== currentId) changed.push('currentId')
  if (prev.current.sig !== itemsSig) changed.push('itemsSig')
  if (prev.current.fe !== feStatus) changed.push('feStatus')
  const autoNow = useUiStore((s) => s.shouldAutoScroll)
  if (prev.current.auto !== autoNow) changed.push('shouldAutoScroll')
  prev.current = { id: currentId, sig: itemsSig, fe: feStatus, auto: autoNow }

  if (DEBUG_RENDERS) {
    // eslint-disable-next-line no-console
    console.log('[SessionPane] change sources =>', changed.length ? changed.join(',') : 'none')
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

function computeLineDelta(before?: string, after?: string): { added: number; removed: number } {
  const a = (before ?? '').split(/\r?\n/)
  const b = (after ?? '').split(/\r?\n/)
  let i = 0, j = 0, added = 0, removed = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (i + 1 < a.length && a[i + 1] === b[j]) { removed++; i++; continue }
    if (j + 1 < b.length && a[i] === b[j + 1]) { added++; j++; continue }
    removed++; added++; i++; j++
  }
  if (i < a.length) removed += (a.length - i)
  if (j < b.length) added += (b.length - j)
  return { added, removed }
}

const InlineBadgeDiff = memo(function InlineBadgeDiff({ badgeId }: { badgeId: string }) {
  // Cached data (kept even when closed)
  const data = useUiStore((s) => (s as any).inlineDiffByBadge?.[badgeId]) as Array<{ path: string; before?: string; after?: string; truncated?: boolean }> | undefined
  const isOpen = useUiStore((s) => !!(s as any).inlineDiffOpenByBadge?.[badgeId])
  const openModal = useUiStore((s) => s.openDiffPreview)
  const closeInline = useUiStore((s) => s.closeInlineDiffForBadge)

  // If no data has ever been loaded for this badge, render nothing (no editor to mount yet)
  if (!data || !data.length) return null

  const f = data[0]
  const { added, removed } = computeLineDelta(f.before, f.after)

  // Keep the editor mounted always; hide/collapse when closed to avoid Monaco model disposal
  const cardStyle: React.CSSProperties = isOpen
    ? { overflow: 'hidden' }
    : { overflow: 'hidden', height: 0, padding: 0, marginTop: 0, border: 'none', visibility: 'hidden' }

  return (
    <Card withBorder padding="xs" mt={6} style={cardStyle} aria-hidden={!isOpen}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={500} style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</Text>
          <MantineBadge size="xs" color="green">+{added}</MantineBadge>
          <MantineBadge size="xs" color="red">-{removed}</MantineBadge>
          {f.truncated ? <MantineBadge size="xs" color="yellow">truncated</MantineBadge> : null}
        </Group>
        <Group gap="xs">
          <Tooltip label="Open all files" withArrow>
            <ActionIcon variant="light" size="sm" onClick={() => openModal(data)}>
              <IconArrowsMaximize size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Close" withArrow>
            <ActionIcon variant="subtle" size="sm" onClick={() => closeInline(badgeId)}>
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <div style={{ height: 240, marginTop: 6 }}>
        <DiffEditor
          height="240px"
          original={f.before ?? ''}
          modified={f.after ?? ''}
          originalModelPath={`inmemory://diff/${badgeId}/${encodeURIComponent(f.path)}?side=original`}
          modifiedModelPath={`inmemory://diff/${badgeId}/${encodeURIComponent(f.path)}?side=modified`}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: false,
            minimap: { enabled: false },
            renderOverviewRuler: false,
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            automaticLayout: true,
            scrollBeyondLastLine: false
          }}
          language={undefined}
        />
      </div>
    </Card>
  )
})


  // Update shouldAutoScroll when user manually scrolls
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = () => {
      const isNearBottom = checkIfNearBottom()
      const current = (useUiStore.getState() as any).shouldAutoScroll
      if (current !== isNearBottom) setShouldAutoScroll(isNearBottom)
    }

    // Set initial state (guarded)
    {
      const initial = checkIfNearBottom()
      const current = (useUiStore.getState() as any).shouldAutoScroll
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
                  style={{
                    backgroundColor: '#1e3a5f',
                    marginLeft: '40px',
                    borderColor: '#2b5a8e',
                  }}
                >
                  <Text size="sm" c="#e0e0e0">{item.content}</Text>
                </Card>
              )
            }

            // Node execution box
            if (item.type === 'node-execution') {
              const box = item as NodeExecutionBox

              // Merge consecutive text items to fix markdown rendering
              // (debounced flushing can split markdown syntax across multiple text items)
              const mergedContent: Array<{ type: 'text'; text: string } | { type: 'badge'; badge: any }> = []
              let textBuffer = ''

              for (const contentItem of box.content) {
                if (contentItem.type === 'text') {
                  textBuffer += contentItem.text
                } else {
                  // Non-text item (badge) - flush accumulated text first
                  if (textBuffer) {
                    mergedContent.push({ type: 'text', text: textBuffer })
                    textBuffer = ''
                  }
                  mergedContent.push(contentItem)
                }
              }

              // Flush any remaining text
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
                              {badge.type === 'error' && (
                                <Text size="xs" c="red.4" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
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
                                const state = useUiStore.getState() as any
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
                                    const dispatch = useDispatch()
                                    await dispatch('loadDiffPreview', { key: payload.key })
                                    const files = (useAppStore as any).getState().feLatestDiffPreview || []
                                    ui.openInlineDiffForBadge(badge.id, files)
                                  } catch (e) {
                                    console.error('Failed to load inline diff preview:', e)
                                  }
                                }
                              } : undefined}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span>
                                  {badge.label}
                                  {badge.status === 'running' && ' ...'}
                                  {badge.status === 'error' && ' ✗'}
                                </span>
                                {typeof badge.addedLines === 'number' && (
                                  <span style={{
                                    marginLeft: 6,
                                    padding: '0 6px',
                                    height: 16,
                                    lineHeight: '16px',
                                    borderRadius: 9999,
                                    border: '1px solid rgba(255,255,255,0.25)',
                                    background: theme.colors.green[8],
                                    color: '#fff',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: 0.3,
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                  }}>+{badge.addedLines}</span>
                                )}
                                {typeof badge.removedLines === 'number' && (
                                  <span style={{
                                    marginLeft: 4,
                                    padding: '0 6px',
                                    height: 16,
                                    lineHeight: '16px',
                                    borderRadius: 9999,
                                    border: '1px solid rgba(255,255,255,0.25)',
                                    background: theme.colors.red[8],
                                    color: '#fff',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: 0.3,
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                  }}>-{badge.removedLines}</span>
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
      style={{
        height: '100%',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DiffPreviewModal />

      {/* Messages Area - takes remaining space */}
      <ScrollArea
        style={{ flex: 1 }}
        scrollbars="y"
        type="auto"
        viewportRef={viewportRef}
      >
        <Stack gap="sm" pr="md">
          {/* Simplified session timeline rendering */}
          {renderedItems}

          {/* Flow status indicator - shows running/waiting/stopped states */}
          <FlowStatusIndicator status={feStatus} />
        </Stack>
      </ScrollArea>

      {/* Input Area - fixed at bottom */}
      {feStatus !== 'stopped' && <SessionInput />}
    </Stack>
  )
}



export default memo(SessionPane)
