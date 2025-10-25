import { useEffect, Profiler } from 'react'
import { Button, Group, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAppStore, useDispatch, selectCurrentView } from './store'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import AgentView from './components/AgentView'
import ExplorerView from './components/ExplorerView'
import SourceControlView from './components/SourceControlView'
import KnowledgeBaseView from './components/KnowledgeBaseView'
import SettingsPane from './SettingsPane'
import LoadingScreen from './components/LoadingScreen'

import { useRerenderTrace, logStoreDiff } from './utils/perf'
// We need a dispatch instance for menu handlers
// This will be set when the App component mounts
let globalDispatch: ReturnType<typeof useDispatch> | null = null

// Menu event handlers - defined once at module level
const menuHandlers = {
  openSettings: () => {
    globalDispatch?.('setCurrentView', { view: 'settings' })
  },
  openSession: () => {
    globalDispatch?.('setCurrentView', { view: 'agent' })
  },
  toggleTerminalPanel: () => {
    globalDispatch?.('setCurrentView', { view: 'explorer' })
    const currentOpen = useAppStore.getState().windowState.explorerTerminalPanelOpen
    globalDispatch?.('updateWindowState', { explorerTerminalPanelOpen: !currentOpen })
  },
  openFolder: async () => {
    const result = await window.workspace?.openFolderDialog?.()
    if (result?.ok && result.path) {
      globalDispatch?.('openFolder', result.path)
    }
  },
  openRecentFolder: async (folderPath: string) => {
    globalDispatch?.('openFolder', folderPath)
  },
  clearRecentFolders: () => {
    globalDispatch?.('clearRecentFolders')
  },
  exportFlow: () => {

    if (!globalDispatch) {
      console.error('[exportFlow] globalDispatch not available yet')
      return
    }

    // Call via dispatch - action runs in main process
    globalDispatch('feExportFlow')
  },
  importFlow: () => {

    if (!globalDispatch) {
      console.error('[importFlow] globalDispatch not available yet')
      return
    }

    // Call via dispatch - action runs in main process
    globalDispatch('feImportFlow')
  }
}

// Track if handlers are registered to prevent duplicates
let handlersRegistered = false


function App() {
  // Get dispatch for menu handlers
  const dispatch = useDispatch()

  // Use selector for better performance
  const currentView = useAppStore(selectCurrentView)
  const appBootstrapping = useAppStore((s) => s.appBootstrapping)
  const startupMessage = useAppStore((s) => s.startupMessage)
  const exportResult = useAppStore((s) => s.feExportResult)
  const importResult = useAppStore((s) => s.feImportResult)

  // Perf: trace App re-renders and subscribe to store diffs (dev only)
  useRerenderTrace('App', { currentView, appBootstrapping, hasExportResult: !!exportResult, hasImportResult: !!importResult })
  useEffect(() => {
    const unsub = (useAppStore as any).subscribe?.((next: any, prev: any) => {
      logStoreDiff('store', prev, next)
    })
    return () => unsub && unsub()
  }, [])


  // Set global dispatch for menu handlers
  useEffect(() => {
    globalDispatch = dispatch
  }, [dispatch])

  // Expose store to window for debugging
  useEffect(() => {
    (window as any).debugStore = useAppStore
  }, [])

  // Show notification when export completes
  useEffect(() => {
    if (!exportResult) return

    if (exportResult.success && exportResult.path) {
      notifications.show({
        title: 'Flow Exported',
        message: `Saved to ${exportResult.path}`,
        color: 'green',
      })
    } else if (exportResult.error) {
      notifications.show({
        title: 'Export Failed',
        message: exportResult.error,
        color: 'red',
      })
    }

    // Clear the result after showing notification
    dispatch('feClearExportResult')
  }, [exportResult, dispatch])

  // Show notification when import completes
  useEffect(() => {
    if (!importResult) return

    if (importResult.success && importResult.name) {
      notifications.show({
        title: 'Flow Imported',
        message: `"${importResult.name}" has been added to your library`,
        color: 'green',
      })
    } else if (importResult.error) {
      notifications.show({
        title: 'Import Failed',
        message: importResult.error,
        color: 'red',
      })
    }

    // Clear the result after showing notification
    dispatch('feClearImportResult')
  }, [importResult, dispatch])

  // Register menu handlers once (via typed preload API)
  useEffect(() => {
    if (handlersRegistered || !window.menu?.on) return

    handlersRegistered = true
    window.menu.on('open-settings', menuHandlers.openSettings)
    window.menu.on('open-session', menuHandlers.openSession)
    window.menu.on('toggle-terminal-panel', menuHandlers.toggleTerminalPanel)
    window.menu.on('open-folder', menuHandlers.openFolder)
    window.menu.on('open-recent-folder', menuHandlers.openRecentFolder)

    window.menu.on('clear-recent-folders', menuHandlers.clearRecentFolders)
    window.menu.on('export-flow', menuHandlers.exportFlow)
    window.menu.on('import-flow', menuHandlers.importFlow)
  }, [])

  // Note: Store initialization is now handled by the main process via zubridge
  // No need to call initializeStore() here


  // Keep main-process menu state in sync with current view (for enabling/disabling items)
  useEffect(() => {
    window.app?.setView?.(currentView)
  }, [currentView])



  // Render the appropriate view based on currentView
  const renderView = () => {
    switch (currentView) {
      case 'agent':
        return <AgentView />
      case 'explorer':
        return <ExplorerView />
      case 'sourceControl':
        return <SourceControlView />
      case 'settings':
        return (
          <div style={{ padding: '16px', backgroundColor: '#1e1e1e', height: '100%', overflow: 'auto' }}>
            <SettingsPane />
          </div>

        )
      case 'knowledgeBase':
        return <KnowledgeBaseView />
      default:
        return <AgentView />
    }
  }


  // Gate UI until boot completes
  if (appBootstrapping) {
    return <LoadingScreen message={startupMessage} />

  }

  return (
    <Profiler
      id="App"
      onRender={(_id, _phase, actualDuration) => {
        if (actualDuration > 16) {
        }
      }}
    >
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Custom Title Bar */}

      <div
        style={{
          height: 36,
          backgroundColor: '#2d2d30',
          borderBottom: '1px solid #3e3e42',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 0,
          WebkitAppRegion: 'drag' as any,
        } as any}
      >
        <Group gap={0} style={{ WebkitAppRegion: 'no-drag' as any } as any}>
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
              style={{
                width: 16,
                height: 16,
                objectFit: 'contain',
              }}
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
                onClick={(e) => {
                  const el = e.currentTarget as HTMLElement
                  const rect = el.getBoundingClientRect()
                  window.menu?.popup?.({ menu: name, x: rect.left, y: rect.bottom })
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
                  e.currentTarget.style.color = '#ffffff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = '#cccccc'
                }}
              >
                {name[0].toUpperCase() + name.slice(1)}
              </div>
            ))}
          </Group>
        </Group>
        <Group gap={0} style={{ WebkitAppRegion: 'no-drag' as any }}>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => window.windowControls?.minimize?.()}
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
            onClick={() => window.windowControls?.maximize?.()}
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
            onClick={() => window.windowControls?.close?.()}
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

      {/* Main Content Area + Status Bar */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
        {/* Content row (ActivityBar + Views) */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Activity Bar */}
          <ActivityBar />


          {/* Main View Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {renderView()}
          </div>
        </div>

        {/* Status Bar */}
        <StatusBar />
      </div>
    </div>
    </Profiler>
  )
}

export default App
