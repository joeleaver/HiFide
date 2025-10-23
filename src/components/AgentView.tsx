import { Text, UnstyledButton, Select, Button } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPlus } from '@tabler/icons-react'
import { useEffect } from 'react'
import {
  useAppStore,
  useDispatch,
  selectSessions,
  selectCurrentId,
  selectAgentTerminalTabs,
} from '../store'
import { useUiStore } from '../store/ui'
import { useTerminalStore } from '../store/terminal'
import SessionPane from '../SessionPane'
import TerminalPanel from './TerminalPanel'
import AgentDebugPanel from './AgentDebugPanel'
import FlowCanvasPanel from './FlowCanvasPanel'
import NodePalettePanel from './NodePalettePanel'
import ContextInspectorPanel from './ContextInspectorPanel'
import TokensCostsPanel from './TokensCostsPanel'
import { ReactFlowProvider } from 'reactflow'

import { useRerenderTrace } from '../utils/perf'
const SHOW_FLOW_DEBUG_PANEL = false



export default function AgentView() {
  // Use dispatch for actions
  const dispatch = useDispatch()

  // Use selectors for better performance
  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)
  const agentTerminalTabs = useAppStore(selectAgentTerminalTabs)
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)

  // Read persisted window state from main store (hydrate UI store on mount only)
  const persistedFlowCanvasCollapsed = useAppStore((s) => s.windowState.flowCanvasCollapsed)
  const persistedMetaPanelOpen = useAppStore((s) => s.windowState.metaPanelOpen)
  const persistedSessionPanelWidth = useAppStore((s) => s.windowState.sessionPanelWidth)
  const persistedMetaPanelWidth = useAppStore((s) => s.windowState.metaPanelWidth)

  // Renderer-only UI state
  const metaPanelOpen = useUiStore((s) => s.metaPanelOpen)
  const flowCanvasCollapsed = useUiStore((s) => s.flowCanvasCollapsed)
  const sessionPanelWidth = useUiStore((s) => s.sessionPanelWidth)
  const metaPanelWidth = useUiStore((s) => s.metaPanelWidth)
  const setMetaPanelOpen = useUiStore((s) => s.setMetaPanelOpen)
  const setFlowCanvasCollapsed = useUiStore((s) => s.setFlowCanvasCollapsed)
  const setSessionPanelWidth = useUiStore((s) => s.setSessionPanelWidth)
  const setMetaPanelWidth = useUiStore((s) => s.setMetaPanelWidth)
  const setIsDraggingSessionPanel = useUiStore((s) => s.setIsDraggingSessionPanel)
  const setIsDraggingMetaPanel = useUiStore((s) => s.setIsDraggingMetaPanel)

  // Perf: trace rerenders for AgentView hot path
  useRerenderTrace('AgentView', {
    metaPanelOpen,
    currentId,
    sessionCount: sessions.length,
    flowCanvasCollapsed,
  })

  // Hydrate UI store with persisted window state ONLY on mount
  useEffect(() => {
    setSessionPanelWidth(persistedSessionPanelWidth)
    setMetaPanelWidth(persistedMetaPanelWidth)
    setMetaPanelOpen(persistedMetaPanelOpen)
    setFlowCanvasCollapsed(persistedFlowCanvasCollapsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // Sync UI store when persisted flowCanvasCollapsed changes (handles async rehydrate)
  useEffect(() => {
    const uiCollapsed = useUiStore.getState().flowCanvasCollapsed
    if (uiCollapsed !== persistedFlowCanvasCollapsed) {
      setFlowCanvasCollapsed(persistedFlowCanvasCollapsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedFlowCanvasCollapsed])


  // Persist metaPanelOpen inline on explicit toggle (see click handlers below)
  // Removed debounced effect to avoid unnecessary windowState churn


  // Session panel resize handler
  const handleSessionPanelMouseDown = (e: React.MouseEvent) => {
    setIsDraggingSessionPanel(true)
    e.preventDefault()

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX
      // Min 200px, max = ensure meta panel stays >= 200px
      const currentMetaPanelWidth = useUiStore.getState().metaPanelWidth
      const metaPanelActualWidth = metaPanelOpen ? currentMetaPanelWidth : 0
      const maxWidth = window.innerWidth - metaPanelActualWidth - 200
      if (newWidth >= 200 && newWidth <= maxWidth) {
        setSessionPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingSessionPanel(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // Persist to main (silent, no broadcast) when drag ends
      dispatch('persistWindowState', { updates: { sessionPanelWidth: useUiStore.getState().sessionPanelWidth } })
      // After layout settles, re-fit all agent terminals to new width and sync PTY size
      requestAnimationFrame(() => agentTerminalTabs.forEach((id) => fitTerminal(id)))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Meta panel resize handler
  const handleMetaPanelMouseDown = (e: React.MouseEvent) => {
    setIsDraggingMetaPanel(true)
    e.preventDefault()

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      // Min 200px, max = ensure session panel stays >= 200px
      const currentSessionPanelWidth = useUiStore.getState().sessionPanelWidth
      const maxWidth = window.innerWidth - currentSessionPanelWidth - 200
      if (newWidth >= 200 && newWidth <= maxWidth) {
        setMetaPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingMetaPanel(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // Persist to main (silent, no broadcast) when drag ends
      dispatch('persistWindowState', { updates: { metaPanelWidth: useUiStore.getState().metaPanelWidth } })
      // After layout settles, re-fit all agent terminals to new width and sync PTY size
      requestAnimationFrame(() => agentTerminalTabs.forEach((id) => fitTerminal(id)))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* Session Panel - Flexible width (grows when flow canvas collapses) */}
      <div
        style={{
          width: flowCanvasCollapsed ? undefined : sessionPanelWidth,
          flex: flowCanvasCollapsed ? 1 : undefined,
          minWidth: 200,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: '#1e1e1e',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Session Selector Bar */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #3e3e42',
            backgroundColor: '#252526',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Select
            value={currentId || undefined}
            onChange={(v) => v && dispatch('select', v)}
            data={sessions.map((sess) => ({
              value: sess.id,
              label: sess.title || 'Untitled',
            }))}
            placeholder="Select session"
            size="xs"
            style={{ flex: 1, maxWidth: 300 }}
            styles={{
              input: {
                backgroundColor: '#1e1e1e',
                border: '1px solid #3e3e42',
                color: '#cccccc',
              },
            }}
          />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => dispatch('newSession')}
          >
            New
          </Button>
        </div>

        {/* Session + Terminal Panel (bottom) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Session Panel - takes remaining space */}
          <div style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}>
            <SessionPane />
          </div>

          {/* Terminal Panel - fixed at bottom, collapses to header only when closed */}
          <TerminalPanel context="agent" />
        </div>

        {/* Resize handle for session panel */}
        <div
          onMouseDown={handleSessionPanelMouseDown}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: 'ew-resize',
            backgroundColor: 'transparent',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#007acc'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        />
      </div>

      {/* Middle section - only takes space when flow canvas is expanded */}
      {!flowCanvasCollapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ReactFlowProvider>
            <FlowCanvasPanel />
          </ReactFlowProvider>
        </div>
      )}

      {/* Toggle button when flow canvas is collapsed */}
      {flowCanvasCollapsed && (
        <UnstyledButton
          onClick={() => {
            setFlowCanvasCollapsed(false)
            dispatch('updateWindowState', { flowCanvasCollapsed: false })
          }}
          style={{
            width: 24,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cccccc',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2d2d30'
            e.currentTarget.style.color = '#ffffff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#252526'
            e.currentTarget.style.color = '#cccccc'
          }}
        >
          <IconChevronLeft size={16} />
        </UnstyledButton>
      )}

      {/* Meta Panel */}
      {metaPanelOpen && (
        <div
          style={{
            width: metaPanelWidth,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Resize handle */}
          <div
            onMouseDown={handleMetaPanelMouseDown}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              cursor: 'ew-resize',
              zIndex: 10,
              background: 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#007acc'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          />
          {/* Meta Panel Header */}
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #3e3e42',
              backgroundColor: '#2d2d30',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text size="sm" fw={600}>
              Tools
            </Text>
            <UnstyledButton
              onClick={() => { setMetaPanelOpen(false); dispatch('updateWindowState', { metaPanelOpen: false }) }}
              style={{
                color: '#cccccc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#cccccc'
              }}
            >
              <IconChevronRight size={16} />
            </UnstyledButton>
          </div>

          {/* Node Palette - Takes remaining space */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <NodePalettePanel />
          </div>

          {/* Context Inspector Panel */}
          <ContextInspectorPanel />

          {/* Tokens & Costs Panel */}
          <TokensCostsPanel />

          {/* Flow Debug Panel - Hidden by default */}
          {SHOW_FLOW_DEBUG_PANEL && <AgentDebugPanel />}
        </div>
      )}

      {/* Toggle button when panel is closed */}
      {!metaPanelOpen && (
        <UnstyledButton
          onClick={() => { setMetaPanelOpen(true); dispatch('updateWindowState', { metaPanelOpen: true }) }}
          style={{
            width: 24,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cccccc',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2d2d30'
            e.currentTarget.style.color = '#ffffff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#252526'
            e.currentTarget.style.color = '#cccccc'
          }}
        >
          <IconChevronLeft size={16} />
        </UnstyledButton>
      )}
    </div>
  )
}

