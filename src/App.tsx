import { useEffect, Profiler, useCallback, useState } from 'react'
import { Button, Group, Title } from '@mantine/core'
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

import { useAppBoot } from './store/appBoot'
import { useHydration, type HydrationState } from './store/hydration'
import { useBackendBinding } from './store/binding'

import { useMenuHandlers } from './hooks/useMenuHandlers'


import classes from './App.module.css'

function App() {
  // Source of truth: workspace attachment state
  const workspaceAttached = useBackendBinding((s: any) => s.attached)

  // Current view within the main app (only used when workspace is attached)
  const currentView = useUiStore((s) => s.currentView)
  const setCurrentViewLocal = useUiStore((s) => s.setCurrentViewLocal)
  const mainCollapsed = useUiStore((s) => s.mainCollapsed)
  const setSessionPanelWidth = useUiStore((s) => s.setSessionPanelWidth)
  const setMainCollapsed = useUiStore((s) => s.setMainCollapsed)

  // Get boot status from store (not local state!)
  const appBootstrapping = useAppBoot((s) => s.appBootstrapping)
  const startupMessage = useAppBoot((s) => s.startupMessage)
  const hydrateBootStatus = useAppBoot((s) => s.hydrateBootStatus)

  // Read directly from hydration store for reliable React re-renders
  const hydrationPhase = useHydration((s: HydrationState) => s.phase)
  const overlayActive = useHydration((s: HydrationState) => s.isLoading)
  const wsLoadingMessage = useHydration((s: HydrationState) => s.loadingMessage)

  // DEBUG: Log every render to see what values the component sees
  console.log('[App render] workspaceAttached:', workspaceAttached, 'currentView:', currentView, 'hydrationPhase:', hydrationPhase, 'overlayActive:', overlayActive, 'appBootstrapping:', appBootstrapping)

  // Hydrate boot status on mount
  useEffect(() => {
    hydrateBootStatus()
  }, [hydrateBootStatus])

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
        await client.whenReady(7000)
        const ws: any = await client.rpc('workspace.get', {})
        if (ws?.ok && ws.root) {
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


  useMenuHandlers()

  // Hydrate per-project layout (session panel width, mainCollapsed) and auto-shrink window if collapsed
  useEffect(() => {
    (async () => {
      try {
        const client = getBackendClient()
        const res: any = await client?.rpc('workspace.getSettings', {})
        const layout = (res && res.settings && res.settings.layout) || {}
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
            try { await getBackendClient()?.rpc('window.setContentSize', { width: targetW, height: targetH }) } catch { }
          }
        }
      } catch { }
    })()
  }, [setSessionPanelWidth, setMainCollapsed])


  const renderView = useCallback(() => {
    // Show welcome screen if no workspace is attached
    if (!workspaceAttached) {
      return <WelcomeScreen />
    }

    // Otherwise show the current view within the main app
    switch (currentView) {
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
          <div className={classes.settingsContainer}>
            <SettingsPane />
          </div>
        )
      case 'welcome':
        // Shouldn't happen when workspace is attached, but fallback to flow
        return <FlowView />
      default:
        return <FlowView />
    }
  }, [workspaceAttached, currentView])

  if (appBootstrapping) {
    return <LoadingScreen message={startupMessage} />
  }

  return (
    <Profiler
      id="App"
      onRender={() => { }}
    >
      <div className={classes.appContainer}>
        <div className={classes.titleBar}>
          <Group gap={0} className={classes.noDrag}>
            <div className={classes.logoContainer}>
              <img
                src="hifide-logo.png"
                alt="HiFide"
                className={classes.logo}
              />
              <Title order={4} className={classes.appTitle}>
                HiFide
              </Title>
            </div>
            <Group gap={0}>
              {(['file', 'edit', 'view', 'window', 'help'] as const).map((name) => (
                <div
                  key={name}
                  className={classes.menuItem}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    window.menu?.popup?.({ menu: name, x: rect.left, y: rect.bottom })
                  }}
                >
                  {name[0].toUpperCase() + name.slice(1)}
                </div>
              ))}
            </Group>
          </Group>

          <Group gap={0} className={classes.noDrag}>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={async () => { try { await getBackendClient()?.rpc('window.minimize', {}) } catch { } }}
              title="Minimize"
              classNames={{ root: classes.windowControl }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1" y="5" width="8" height="1" fill="currentColor" />
              </svg>
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={async () => { try { await getBackendClient()?.rpc('window.toggleMaximize', {}) } catch { } }}
              title="Maximize"
              classNames={{ root: classes.windowControl }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={async () => { try { await getBackendClient()?.rpc('window.close', {}) } catch { } }}
              title="Close"
              classNames={{ root: classes.closeButton }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </Button>
          </Group>
        </div>

        <div className={classes.mainContent}>
          <div className={classes.workspace}>
            {!workspaceAttached ? (
              <div className={classes.viewContainer}>{renderView()}</div>
            ) : (
              <>
                <GlobalSessionPanel />
                <ActivityBar />
                {mainCollapsed ? null : (
                  <div className={classes.viewContainer}>{renderView()}</div>
                )}
              </>
            )}
          </div>
          {!workspaceAttached ? null : <StatusBar />}
        </div>
      </div>
      {overlayActive && (
        <div className={classes.loadingOverlay}>
          <LoadingScreen message={wsLoadingMessage || 'Opening workspace…'} />
        </div>
      )}


    </Profiler>
  )
}

export default App
