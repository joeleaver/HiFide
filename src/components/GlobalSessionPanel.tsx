import { Button, Select, Loader } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useEffect } from 'react'
import { useUiStore } from '../store/ui'
import { useSessionUi } from '../store/sessionUi'
import { useChatTimeline } from '../store/chatTimeline'
import SessionPane from '../SessionPane'
import TotalCostDisplay from './TotalCostDisplay'
import { getBackendClient } from '../lib/backend/bootstrap'
import { MIN_SESSION_PANEL_WIDTH, ACTIVITY_BAR_WIDTH } from '../constants/layout'

export default function GlobalSessionPanel() {
  const sessions = useSessionUi((s: any) => s.sessions)
  const currentId = useSessionUi((s: any) => s.currentId)
  const selectSession = useSessionUi((s: any) => s.selectSession)
  const newSession = useSessionUi((s: any) => s.newSession)
  const isHydratingMeta = useSessionUi((s: any) => s.isHydratingMeta)
  const isHydratingUsage = useSessionUi((s: any) => s.isHydratingUsage)
  const isHydratingTimeline = useChatTimeline((s: any) => s.isHydrating)
  const isHydrating = !!(isHydratingMeta || isHydratingUsage || isHydratingTimeline)

  const sessionPanelWidth = useUiStore((s) => s.sessionPanelWidth)
  const setSessionPanelWidth = useUiStore((s) => s.setSessionPanelWidth)
  const mainCollapsed = useUiStore((s) => (s as any).mainCollapsed)
  const setIsDraggingSessionPanel = useUiStore((s) => s.setIsDraggingSessionPanel)

  // No session-effect subscriptions here: store handles all event wiring

  // Persist layout to per-project settings
  async function persistLayout(next?: { width?: number; mainCollapsed?: boolean }) {
    try {
      const client = getBackendClient()
      const settingsRes: any = await client?.rpc('workspace.getSettings', {})
      const prev = (settingsRes && settingsRes.settings) || {}
      const layout = { ...(prev.layout || {}), sessionPanelWidth: next?.width ?? sessionPanelWidth, mainCollapsed: next?.mainCollapsed ?? mainCollapsed }
      await client?.rpc('workspace.setSetting', { key: 'layout', value: layout })
    } catch {}
  }

  // When collapsed, session panel should grow/shrink to fill the window content width (minus the activity bar)
  useEffect(() => {
    if (!mainCollapsed) return
    const recompute = () => {
      const target = Math.max(MIN_SESSION_PANEL_WIDTH, (window.innerWidth || 0) - ACTIVITY_BAR_WIDTH)
      const current = useUiStore.getState().sessionPanelWidth
      if (Math.abs(target - current) > 1) {
        setSessionPanelWidth(target)
      }
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => { window.removeEventListener('resize', recompute) }
  }, [mainCollapsed, setSessionPanelWidth])

  const handleSessionPanelMouseDown = (e: React.MouseEvent) => {
    if (mainCollapsed) return // no resize when main is hidden
    setIsDraggingSessionPanel(true)
    e.preventDefault()

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = ev.clientX
      const maxWidth = Math.max(MIN_SESSION_PANEL_WIDTH, window.innerWidth - ACTIVITY_BAR_WIDTH - 200)
      if (newWidth >= MIN_SESSION_PANEL_WIDTH && newWidth <= maxWidth) {
        setSessionPanelWidth(newWidth)
      }
    }

    const handleMouseUp = async () => {
      setIsDraggingSessionPanel(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      await persistLayout({ width: useUiStore.getState().sessionPanelWidth })
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      style={{
        width: sessionPanelWidth,
        // keep fixed width even when main is collapsed
        minWidth: MIN_SESSION_PANEL_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#1e1e1e',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        borderRight: '1px solid #3e3e42',
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
          flexShrink: 0,
        }}
      >
        <Select
          value={currentId || undefined}
          onChange={async (v) => { if (v) await selectSession(v) }}
          data={(sessions || []).map((sess: any) => ({ value: sess.id, label: sess.title || 'Untitled' }))}
          placeholder="Select session"
          size="xs"
          rightSection={isHydrating ? <Loader size="xs" /> : null}
          rightSectionPointerEvents="none"
          style={{ flex: 1, maxWidth: 300 }}
          styles={{ input: { backgroundColor: '#1e1e1e', border: '1px solid #3e3e42', color: '#cccccc' } }}
        />
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          disabled={isHydrating}
          onClick={async () => { await newSession() }}
        >
          New
        </Button>
        <TotalCostDisplay />
      </div>

      {/* Session content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SessionPane />
        </div>
      </div>

      {/* Resize handle for session panel (only when main is visible) */}
      {!mainCollapsed && (
        <div
          onMouseDown={handleSessionPanelMouseDown}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'ew-resize', backgroundColor: 'transparent', zIndex: 10 }}
          onMouseEnter={(ev) => { ev.currentTarget.style.backgroundColor = '#007acc' }}
          onMouseLeave={(ev) => { ev.currentTarget.style.backgroundColor = 'transparent' }}
        />
      )}
    </div>
  )
}

