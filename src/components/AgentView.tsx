import { Text, UnstyledButton, Select, Button } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPlus } from '@tabler/icons-react'
import { useEffect } from 'react'
import {
  useAppStore,
  useDispatch,
  selectMetaPanelOpen,
  selectSessions,
  selectCurrentId,
} from '../store'
import { useUiStore } from '../store/ui'
import SessionPane from '../SessionPane'
import TerminalPanel from './TerminalPanel'
import AgentDebugPanel from './AgentDebugPanel'
import FlowCanvasPanel from './FlowCanvasPanel'
import NodePalettePanel from './NodePalettePanel'
import ContextInspectorPanel from './ContextInspectorPanel'
import TokensCostsPanel from './TokensCostsPanel'
import { ReactFlowProvider } from 'reactflow'



export default function AgentView() {
  // Use dispatch for actions
  const dispatch = useDispatch()

  // Use selectors for better performance
  const metaPanelOpen = useAppStore(selectMetaPanelOpen)
  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)
  const flowCanvasCollapsed = useAppStore((s) => s.windowState.flowCanvasCollapsed)

  // Read persisted widths from main store
  const persistedSessionPanelWidth = useAppStore((s) => s.windowState.sessionPanelWidth)
  const persistedMetaPanelWidth = useAppStore((s) => s.windowState.metaPanelWidth)

  // Use UI store for local resize state
  const sessionPanelWidth = useUiStore((s) => s.sessionPanelWidth)
  const metaPanelWidth = useUiStore((s) => s.metaPanelWidth)
  const setSessionPanelWidth = useUiStore((s) => s.setSessionPanelWidth)
  const setMetaPanelWidth = useUiStore((s) => s.setMetaPanelWidth)
  const setIsDraggingSessionPanel = useUiStore((s) => s.setIsDraggingSessionPanel)
  const setIsDraggingMetaPanel = useUiStore((s) => s.setIsDraggingMetaPanel)

  // Sync UI store with persisted widths ONLY on mount
  // Don't sync during runtime to avoid race conditions with drag updates
  useEffect(() => {
    setSessionPanelWidth(persistedSessionPanelWidth)
    setMetaPanelWidth(persistedMetaPanelWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

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
      // Persist to main store when drag ends
      dispatch('updateWindowState', { sessionPanelWidth: useUiStore.getState().sessionPanelWidth })
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
      // Persist to main store when drag ends
      dispatch('updateWindowState', { metaPanelWidth: useUiStore.getState().metaPanelWidth })
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
          onClick={() => dispatch('updateWindowState', { flowCanvasCollapsed: false })}
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
              onClick={() => dispatch('updateWindowState', { metaPanelOpen: false })}
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

          {/* Flow Debug Panel - Fixed at bottom */}
          <AgentDebugPanel />
        </div>
      )}

      {/* Toggle button when panel is closed */}
      {!metaPanelOpen && (
        <UnstyledButton
          onClick={() => dispatch('updateWindowState', { metaPanelOpen: true })}
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

