import { Text, UnstyledButton } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useEffect } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useUiStore } from '../store/ui'
import AgentDebugPanel from './AgentDebugPanel'
import FlowCanvasPanel from './FlowCanvasPanel'
import NodePalettePanel from './NodePalettePanel'
import ContextInspectorPanel from './ContextInspectorPanel'
import TokensCostsPanel from './TokensCostsPanel'
import { ReactFlowProvider } from 'reactflow'

import { useRerenderTrace } from '../utils/perf'
const SHOW_FLOW_DEBUG_PANEL = false

export default function FlowView() {
  // Renderer-only UI state
  const metaPanelOpen = useUiStore((s) => s.metaPanelOpen)
  const metaPanelWidth = useUiStore((s) => s.metaPanelWidth)
  const setMetaPanelOpen = useUiStore((s) => s.setMetaPanelOpen)
  const setMetaPanelWidth = useUiStore((s) => s.setMetaPanelWidth)
  const setIsDraggingMetaPanel = useUiStore((s) => s.setIsDraggingMetaPanel)

  // Perf: trace rerenders for FlowView hot path
  useRerenderTrace('FlowView', { metaPanelOpen })

  // Hydrate UI store window state via WS on mount
  useEffect(() => {
    (async () => {
      try {
        const res: any = await getBackendClient()?.rpc('ui.getWindowState', {})
        const ws = res?.windowState || {}
        setMetaPanelWidth(typeof ws.metaPanelWidth === 'number' ? ws.metaPanelWidth : 300)
        setMetaPanelOpen(Boolean(ws.metaPanelOpen))
      } catch {}
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Meta panel resize handler
  const handleMetaPanelMouseDown = (e: React.MouseEvent) => {
    setIsDraggingMetaPanel(true)
    e.preventDefault()

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      if (newWidth >= 200) {
        setMetaPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingMetaPanel(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      void getBackendClient()?.rpc('ui.updateWindowState', { updates: { metaPanelWidth: useUiStore.getState().metaPanelWidth } })
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
      {/* Main Flow Canvas Area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ReactFlowProvider>
          <FlowCanvasPanel />
        </ReactFlowProvider>
      </div>

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
              onClick={() => { setMetaPanelOpen(false); void getBackendClient()?.rpc('ui.updateWindowState', { updates: { metaPanelOpen: false } }) }}
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
          onClick={() => { setMetaPanelOpen(true); void getBackendClient()?.rpc('ui.updateWindowState', { updates: { metaPanelOpen: true } }) }}
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

