import { Text, UnstyledButton, Stack, Skeleton, Center, Button } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconRefresh, IconAlertTriangle } from '@tabler/icons-react'

import { useUiStore } from '../store/ui'
import { useFlowEditorHydration } from '../store/screenHydration'
import { useFlowEditor } from '../store/flowEditor'
import { reloadFlowEditorScreen } from '../store/flowEditorScreenController'
import AgentDebugPanel from './AgentDebugPanel'
import FlowCanvasPanel from './FlowCanvasPanel'
import NodePalettePanel from './NodePalettePanel'
import ContextInspectorPanel from './ContextInspectorPanel'
import TokensCostsPanel from './TokensCostsPanel'
import { ReactFlowProvider } from 'reactflow'

import { useRerenderTrace } from '../utils/perf'
const SHOW_FLOW_DEBUG_PANEL = false

/**
 * Skeleton for the Flow Editor while loading
 */
function FlowEditorSkeleton() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
      {/* Toolbar skeleton */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Skeleton width={120} height={32} radius="sm" />
        <Skeleton width={100} height={32} radius="sm" />
        <Skeleton width={80} height={32} radius="sm" />
      </div>
      {/* Canvas skeleton */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Skeleton width="100%" height="100%" radius="sm" />
        {/* Fake nodes */}
        <div style={{ position: 'absolute', top: 40, left: 40 }}>
          <Skeleton width={180} height={80} radius="md" />
        </div>
        <div style={{ position: 'absolute', top: 100, left: 280 }}>
          <Skeleton width={180} height={80} radius="md" />
        </div>
        <div style={{ position: 'absolute', top: 200, left: 160 }}>
          <Skeleton width={180} height={80} radius="md" />
        </div>
      </div>
    </div>
  )
}

export default function FlowView() {
  // Screen hydration state
  const screenPhase = useFlowEditorHydration((s) => s.phase)
  const screenError = useFlowEditorHydration((s) => s.error)


  // Renderer-only UI state
  const metaPanelOpen = useUiStore((s) => s.metaPanelOpen)
  const metaPanelWidth = useUiStore((s) => s.metaPanelWidth)
  const setMetaPanelOpen = useUiStore((s) => s.setMetaPanelOpen)
  const setMetaPanelWidth = useUiStore((s) => s.setMetaPanelWidth)
  const setIsDraggingMetaPanel = useUiStore((s) => s.setIsDraggingMetaPanel)

  // Perf: trace rerenders for FlowView hot path
  useRerenderTrace('FlowView', { metaPanelOpen, screenPhase })


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
      // Width is already persisted to localStorage by setMetaPanelWidth
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Render loading/error/content based on phase
  // NOTE: setReady() only transitions from loading/refreshing → ready.
  // If the phase stays 'idle', the skeleton will be shown forever.
  // Therefore: when the graph store is hydrated, ensure we move to loading (if idle)
  // and then to ready.
  if (screenPhase === 'idle' || screenPhase === 'loading') return <FlowEditorSkeleton />

  if (screenPhase === 'error') {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
          <Text size="sm" c="dimmed" ta="center">
            {screenError ?? 'Failed to load flow editor'}
          </Text>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              reloadFlowEditorScreen()
              useFlowEditor.getState().hydrateTemplates()
            }}
          >
            Retry
          </Button>
        </Stack>
      </Center>
    )
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
              onClick={() => setMetaPanelOpen(false)}
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
          onClick={() => setMetaPanelOpen(true)}
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

