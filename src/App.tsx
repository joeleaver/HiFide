import { useEffect, Profiler, useCallback, useState } from 'react'
import { Button, Group, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import FlowView from './components/FlowView'
import ExplorerView from './components/ExplorerView'
import SourceControlView from './components/SourceControlView'
import KnowledgeBaseView from './components/KnowledgeBaseView'
import KanbanView from './components/KanbanView'
import SettingsPane from './SettingsPane'
import WelcomeScreen from './components/WelcomeScreen'
import GlobalSessionPanel from './components/GlobalSessionPanel'

import LoadingScreen from './components/LoadingScreen'
import { useRerenderTrace } from './utils/perf'
import { useUiStore } from './store/ui'
import { getBackendClient } from './lib/backend/bootstrap'

import { useBackendBinding } from './store/binding'
import type { BackendBindingState } from './store/binding'
import { useSessionUi } from './store/sessionUi'
import { useChatTimeline } from './store/chatTimeline'

import { useLoadingOverlay } from './store/loadingOverlay'

let handlersRegistered = false

const menuHandlers = {
  openSettings: async () => {
    try { await getBackendClient()?.rpc('view.set', { view: 'settings' }) } catch {}
    try { (useUiStore as any).setState?.({ currentView: 'settings' }) } catch {}
  },
  openSession: async () => {
    try { await getBackendClient()?.rpc('view.set', { view: 'flow' }) } catch {}
    try { (useUiStore as any).setState?.({ currentView: 'flow' }) } catch {}
  },
  openFlowEditor: async () => {
    try { await getBackendClient()?.rpc('view.set', { view: 'flow' }) } catch {}
    try { (useUiStore as any).setState?.({ currentView: 'flow' }) } catch {}
  },
  openKanban: async () => {
    try { await getBackendClient()?.rpc('view.set', { view: 'kanban' }) } catch {}
    try { (useUiStore as any).setState?.({ currentView: 'kanban' }) } catch {}
  },
  toggleTerminalPanel: async () => {
    try {
      await getBackendClient()?.rpc('ui.toggleWindowState', { key: 'explorerTerminalPanelOpen' })
    } catch (e) {
      // Silently ignore menu toggle errors; user can retry from UI
    }
  },
  openFolder: async () => {
    const result = await window.workspace?.openFolderDialog?.()
    if (result?.ok && result.path) {
      const client = getBackendClient()
      if (!client) return
      try {
        await (client as any).whenReady?.(7000)
      } catch {}
      try {
        await client.rpc('workspace.open', { root: result.path })
        // View will switch to 'flow' on workspace.ready
      } catch (e) {
        // Silently ignore openFolder failures here; StatusBar can reflect workspace state
      }
    }
  },
  openRecentFolder: async (folderPath: string) => {
    const client = getBackendClient()
    if (!client) return
    try {
      await (client as any).whenReady?.(7000)
    } catch {}
    try {
      await client.rpc('workspace.open', { root: folderPath })
      // View will switch to 'flow' on workspace.ready
    } catch (e) {
      // Silently ignore openRecentFolder failures; user can retry selection
    }
  },
  clearRecentFolders: async () => {
    try { await getBackendClient()?.rpc('workspace.clearRecentFolders', {}) } catch (e) {
      // Silently ignore clearRecentFolders failures
    }
  },
  exportFlow: async () => {
    try {
      const res: any = await getBackendClient()?.rpc('flowEditor.exportFlow', {})
      const result = res?.result
      if (res?.ok && result) {
        if (result.canceled) return
        if (result.success) {
          notifications.show({ color: 'green', title: 'Exported', message: result.path || 'Flow exported' })
        } else {
          notifications.show({ color: 'red', title: 'Export failed', message: result.error || 'Unknown error' })
        }
      } else if (res && res.error) {
        notifications.show({ color: 'red', title: 'Export failed', message: String(res.error) })
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Export failed', message: String(e) })
    }
  },
  importFlow: async () => {
    try {
      const res: any = await getBackendClient()?.rpc('flowEditor.importFlow', {})
      const result = res?.result
      if (res?.ok && result) {
        if (result.canceled) return
        if (result.success) {
          notifications.show({ color: 'green', title: 'Imported', message: result.name || 'Flow imported' })
        } else {
          notifications.show({ color: 'red', title: 'Import failed', message: result.error || 'Unknown error' })
        }
      } else if (res && res.error) {
        notifications.show({ color: 'red', title: 'Import failed', message: String(res.error) })
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Import failed', message: String(e) })
    }
  },
}

function registerMenuHandlers() {
  if (handlersRegistered || !window.menu?.on) return

  window.menu.on('open-settings', menuHandlers.openSettings)
  window.menu.on('open-session', menuHandlers.openSession)
  window.menu.on('open-chat', menuHandlers.openSession)
  window.menu.on('open-flow-editor', menuHandlers.openFlowEditor)
  window.menu.on('open-kanban', menuHandlers.openKanban)
  window.menu.on('toggle-terminal-panel', menuHandlers.toggleTerminalPanel)
  window.menu.on('open-folder', menuHandlers.openFolder)
  window.menu.on('open-recent-folder', menuHandlers.openRecentFolder)
  window.menu.on('clear-recent-folders', menuHandlers.clearRecentFolders)
  window.menu.on('export-flow', menuHandlers.exportFlow)
  window.menu.on('import-flow', menuHandlers.importFlow)

  handlersRegistered = true
}

function unregisterMenuHandlers() {
  if (!handlersRegistered || !window.menu?.off) return

  window.menu.off('open-settings', menuHandlers.openSettings)
  window.menu.off('open-session', menuHandlers.openSession)
  window.menu.off('open-chat', menuHandlers.openSession)
  window.menu.off('open-flow-editor', menuHandlers.openFlowEditor)
  window.menu.off('open-kanban', menuHandlers.openKanban)
  window.menu.off('toggle-terminal-panel', menuHandlers.toggleTerminalPanel)
  window.menu.off('open-folder', menuHandlers.openFolder)
  window.menu.off('open-recent-folder', menuHandlers.openRecentFolder)
  window.menu.off('clear-recent-folders', menuHandlers.clearRecentFolders)
  window.menu.off('export-flow', menuHandlers.exportFlow)
  window.menu.off('import-flow', menuHandlers.importFlow)

  handlersRegistered = false
}

function App() {
  const currentView = useUiStore((s) => s.currentView)
  const setCurrentViewLocal = useUiStore((s) => (s as any).setCurrentViewLocal)
  const mainCollapsed = useUiStore((s) => (s as any).mainCollapsed)
  const setSessionPanelWidth = useUiStore((s) => s.setSessionPanelWidth)
  const setMainCollapsed = useUiStore((s) => (s as any).setMainCollapsed)

  const [appBootstrapping, setAppBootstrapping] = useState<boolean>(true)
  const [startupMessage, setStartupMessage] = useState<string | null>(null)
  const { active: wsLoading, message: wsLoadingMessage, overlayAgeMs, hydratingAgeMs, phase: wsPhase } = useLoadingOverlay()
  const showDebugOverlay = (() => { try { return localStorage.getItem('hifide.debug.overlay') === '1' } catch { return false } })()
  // HUD-only selectors (no effects)
  const bindingRoot = useBackendBinding((s: BackendBindingState) => s.root)
  const attached = useBackendBinding((s: BackendBindingState) => s.attached)
  const workspaceId = useBackendBinding((s: BackendBindingState) => s.workspaceId)
  const sessionsCount = useSessionUi((s: any) => (s.sessions?.length || 0))
  const currentSessionId = useSessionUi((s: any) => s.currentId)
  const timelineHydrating = useChatTimeline((s: any) => s.isHydrating)
  const timelineRenderedOnce = useChatTimeline((s: any) => s.hasRenderedOnce)
  const hydMeta = useSessionUi((s: any) => s.isHydratingMeta)
  const hydUsage = useSessionUi((s: any) => s.isHydratingUsage)
  const listHydrated = useSessionUi((s: any) => s.hasHydratedList)
  const sessionEventsInited = useSessionUi((s: any) => s.eventsInited)
  const boot = (window as any)?.wsBackend?.getBootstrap?.()
  const bootUrl = boot?.url || null
  const bootWindowId = boot?.windowId || null


  // Keep overlay visible if workspace bound but either the sessions list is not hydrated yet
  // OR timeline/meta/usage are hydrating
  // OR there is at least one session but the timeline has not completed its
  // first render yet (closes any recompute gap between flags and the actual
  // UI becoming stable). For a truly empty workspace (no sessions), don't gate
  // on hasRenderedOnce.
  const overlayActive = wsLoading || (
    attached && (
      !listHydrated ||
      (sessionsCount > 0 && !timelineRenderedOnce) ||
      timelineHydrating ||
      hydMeta ||
      hydUsage
    )
  )




  // Hydrate boot status via snapshot-after-subscribe (race-proof). Show a connecting message until WS is ready.
  useEffect(() => {
    let off: (() => void) | undefined
    let pollTimer: any
    const run = async () => {
      const client = getBackendClient()
      if (!client) {
        setStartupMessage('Connecting to backend…')
        return
      }
      // Distinct pre-WS message
      setStartupMessage('Connecting to backend…')
      try {
        await (client as any).whenReady?.(7000)
      } catch {}
      // Subscribe first to avoid missing an in-flight state change between snapshot and subscribe
      off = client.subscribe('app.boot.changed', (p: any) => {
        setAppBootstrapping(!!p?.appBootstrapping)
        setStartupMessage(p?.startupMessage || null)
      })
      // Then request a snapshot of current boot status
      try {
        const res: any = await client.rpc('app.getBootStatus', {})
        if (res?.ok) {
          setAppBootstrapping(!!res.appBootstrapping)
          setStartupMessage(res.startupMessage || null)
        }
      } catch {}

      // Fallback: while bootstrapping, poll snapshot periodically in case a WS event is missed
      // This avoids getting visually "stuck" on an old message if a notification is dropped
      pollTimer = setInterval(async () => {
        try {
          // If we already finished bootstrapping, stop polling
          if (!appBootstrapping) { clearInterval(pollTimer); pollTimer = null; return }
          const snap: any = await client.rpc('app.getBootStatus', {})
          if (snap?.ok) {
            setAppBootstrapping(!!snap.appBootstrapping)
            setStartupMessage(snap.startupMessage || null)
            if (!snap.appBootstrapping && pollTimer) { clearInterval(pollTimer); pollTimer = null }
          }
        } catch {}
      }, 1500)
    }
    run()
    return () => { try { off?.() } catch {}; if (pollTimer) clearInterval(pollTimer) }
  }, [appBootstrapping])

  useRerenderTrace('App', {
    currentView,
    appBootstrapping,
  })



  // Hydrate currentView once: if a workspace is already bound, force 'flow'.
  // Do not force 'welcome' here; let workspaceUi re-check after handshake.
  useEffect(() => {
    (async () => {
      try {
        const client = getBackendClient()
        if (!client) return
        await (client as any).whenReady?.(7000)
        const ws: any = await client.rpc('workspace.get', {})
        if (ws?.ok && ws.root) {
          try { await client.rpc('view.set', { view: 'flow' }) } catch {}
          setCurrentViewLocal('flow')
        }
      } catch {
        // ignore; default 'flow' remains
      }
    })()
  }, [setCurrentViewLocal])

















	      // Tick while overlay/hydration is active so timeouts can elapse without other state changes
	      const [nowTick, setNowTick] = useState<number>(0)
  if (false) { setNowTick(nowTick) }

	      /* useEffect(() => {
	        const watching = overlaySince !== null || hydratingSince !== null
	        if (!watching) return
	        setNowTick(Date.now())
	        const id = window.setInterval(() => setNowTick(Date.now()), 250)
	        return () => window.clearInterval(id)
	      }, [overlaySince, hydratingSince]) */


  useEffect(() => {
    registerMenuHandlers()
    return () => {
      unregisterMenuHandlers()
    }
  }, [])
  // Hydrate per-project layout (session panel width, mainCollapsed) and auto-shrink window if collapsed
  useEffect(() => {
    (async () => {
      try {
        const res = await window.workspace?.getSettings?.()
        const layout = (res && (res as any).settings && (res as any).settings.layout) || {}
        // Restore Session Panel width first
        let spw = 300
        if (typeof layout.sessionPanelWidth === 'number') {
          spw = Math.max(240, layout.sessionPanelWidth)
          setSessionPanelWidth(spw)
        }
        // Restore collapsed state
        if (typeof layout.mainCollapsed === 'boolean') {
          setMainCollapsed(layout.mainCollapsed)
          // If starting collapsed, shrink the window right away to Session + Nav width
          if (layout.mainCollapsed) {
            const NAV_W = 48
            const targetW = Math.max(300, Math.floor(spw + NAV_W))
            const targetH = Math.max(300, Math.floor(window.innerHeight || 600))
            try { await getBackendClient()?.rpc('window.setContentSize', { width: targetW, height: targetH }) } catch {}
          }
        }
      } catch {}
    })()
  }, [setSessionPanelWidth, setMainCollapsed])


  const renderView = useCallback(() => {
    switch (currentView) {
      case 'welcome':
        return <WelcomeScreen />
      case 'flow':
        return <FlowView />
      case 'explorer':

        return <ExplorerView />
      case 'sourceControl':
        return <SourceControlView />
      case 'knowledgeBase':
        return <KnowledgeBaseView />
      case 'kanban':
        return <KanbanView />
      case 'settings':
        return (
          <div style={{ padding: '16px', backgroundColor: '#1e1e1e', height: '100%', overflow: 'auto' }}>
            <SettingsPane />
          </div>
        )
      default:
        return <FlowView />
    }
  }, [currentView])

  if (appBootstrapping) {
    return <LoadingScreen message={startupMessage} />
  }

  return (
    <Profiler
      id="App"
      onRender={() => {}}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div
          style={{
            height: 36,
            backgroundColor: '#2d2d30',
            borderBottom: '1px solid #3e3e42',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 0,
            WebkitAppRegion: 'drag',
          } as any}
        >
          <Group gap={0} style={{ WebkitAppRegion: 'no-drag' } as any}>
            <div
              style={{
                padding: '0 8px 0 6px',
                height: 36,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <img
                src="hifide-logo.png"
                alt="HiFide"
                style={{ width: 16, height: 16, objectFit: 'contain' }}
              />
              <Title order={4} style={{ fontWeight: 600, fontSize: '13px', color: '#cccccc' }}>
                HiFide
              </Title>
            </div>
            <Group gap={0}>
              {(['file', 'edit', 'view', 'window', 'help'] as const).map((name) => (
                <div
                  key={name}
                  style={{
                    padding: '0 12px',
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'default',
                    fontSize: '13px',
                    color: '#cccccc',
                    transition: 'background-color 0.1s ease, color 0.1s ease',
                  }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    window.menu?.popup?.({ menu: name, x: rect.left, y: rect.bottom })
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
                    event.currentTarget.style.color = '#ffffff'
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = 'transparent'
                    event.currentTarget.style.color = '#cccccc'
                  }}
                >
                  {name[0].toUpperCase() + name.slice(1)}
                </div>
              ))}
            </Group>
          </Group>

          <Group gap={0} style={{ WebkitAppRegion: 'no-drag' } as any }>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={async () => { try { await getBackendClient()?.rpc('window.minimize', {}) } catch {} }}
              title="Minimize"
              styles={{
                root: {
                  color: '#cccccc',
                  width: 46,
                  height: 36,
                  borderRadius: 0,
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  },
                },
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1" y="5" width="8" height="1" fill="currentColor" />
              </svg>
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={async () => { try { await getBackendClient()?.rpc('window.toggleMaximize', {}) } catch {} }}
              title="Maximize"
              styles={{
                root: {
                  color: '#cccccc',
                  width: 46,
                  height: 36,
                  borderRadius: 0,
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  },
                },
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={async () => { try { await getBackendClient()?.rpc('window.close', {}) } catch {} }}
              title="Close"
              styles={{
                root: {
                  color: '#cccccc',
                  width: 46,
                  height: 36,
                  borderRadius: 0,
                  '&:hover': {
                    backgroundColor: '#e81123',
                    color: '#ffffff',
                  },
                },
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </Button>
          </Group>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {currentView === 'welcome' ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{renderView()}</div>
            ) : (
              <>
                <GlobalSessionPanel />
                <ActivityBar />
                {mainCollapsed ? null : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{renderView()}</div>
                )}
              </>
            )}
          </div>
          {currentView === 'welcome' ? null : <StatusBar />}
        </div>
      </div>
      {overlayActive && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000 }}>
          <LoadingScreen message={wsLoadingMessage || 'Opening workspace…'} />
        </div>
      )}
      {showDebugOverlay && (
        <div style={{ position: 'fixed', right: 8, bottom: 8, background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 11, padding: '8px 10px', borderRadius: 6, zIndex: 10001, pointerEvents: 'none' }}>
          <div><strong>Loading Debug</strong></div>
          <div>view: {currentView}</div>
          <div>root: {bindingRoot || '-'} | attached: {String(attached)} | wsId: {workspaceId || '-'} | sessions: {sessionsCount} | sel: {currentSessionId || '-'} | list: {String(listHydrated)} | sEv: {String(sessionEventsInited)}</div>
          <div>hydrating: t={String(timelineHydrating)} m={String(hydMeta)} u={String(hydUsage)} | wsLoading: {String(wsLoading)} | show: {String(overlayActive)}</div>
          <div>msg: {wsLoadingMessage || '-'} | phase: {wsPhase}</div>
          <div>overlayAge: {overlayAgeMs} | hydAge: {hydratingAgeMs}</div>
    <div>ws: {bootUrl || '-'} | windowId: {String(bootWindowId || '-')}</div>
        </div>
      )}


    </Profiler>
  )
}

export default App
