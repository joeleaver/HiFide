import { useEffect, Profiler, useCallback } from 'react'
import { Button, Group, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAppStore, useDispatch, selectCurrentView } from './store'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import AgentView from './components/AgentView'
import ExplorerView from './components/ExplorerView'
import SourceControlView from './components/SourceControlView'
import KnowledgeBaseView from './components/KnowledgeBaseView'
import KanbanView from './components/KanbanView'
import SettingsPane from './SettingsPane'
import LoadingScreen from './components/LoadingScreen'
import { useRerenderTrace, logStoreDiff } from './utils/perf'

let globalDispatch: ReturnType<typeof useDispatch> | null = null
let handlersRegistered = false

const menuHandlers = {
  openSettings: () => {
    globalDispatch?.('setCurrentView', { view: 'settings' })
  },
  openSession: () => {
    globalDispatch?.('setCurrentView', { view: 'agent' })
  },
  openFlowEditor: () => {
    globalDispatch?.('setCurrentView', { view: 'flowEditor' })
  },
  openKanban: () => {
    globalDispatch?.('setCurrentView', { view: 'kanban' })
  },
  toggleTerminalPanel: () => {
    const store = useAppStore.getState()
    const isOpen = store.windowState?.explorerTerminalPanelOpen ?? false
    globalDispatch?.('updateWindowState', { explorerTerminalPanelOpen: !isOpen })
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
      console.error('[menu] exportFlow invoked before dispatch ready')
      return
    }
    globalDispatch('feExportFlow')
  },
  importFlow: () => {
    if (!globalDispatch) {
      console.error('[menu] importFlow invoked before dispatch ready')
      return
    }
    globalDispatch('feImportFlow')
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
  const dispatch = useDispatch()

  const currentView = useAppStore(selectCurrentView)
  const appBootstrapping = useAppStore((state) => state.appBootstrapping)
  const startupMessage = useAppStore((state) => state.startupMessage)
  const exportResult = useAppStore((state) => state.feExportResult)
  const importResult = useAppStore((state) => state.feImportResult)

  useRerenderTrace('App', {
    currentView,
    appBootstrapping,
    hasExportResult: !!exportResult,
    hasImportResult: !!importResult,
  })

  useEffect(() => {
    const unsubscribe = (useAppStore as any).subscribe?.((next: any, prev: any) => {
      logStoreDiff('store', prev, next)
    })
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  useEffect(() => {
    globalDispatch = dispatch
    return () => {
      if (globalDispatch === dispatch) {
        globalDispatch = null
      }
    }
  }, [dispatch])

  useEffect(() => {
    (window as any).debugStore = useAppStore
  }, [])

  useEffect(() => {
    if (!exportResult) return

    if (exportResult.success && exportResult.path) {
      notifications.show({
        title: 'Flow Exported',
        message: `Exported to ${exportResult.path}`,
        color: 'green',
      })
    } else if (exportResult.error) {
      notifications.show({
        title: 'Export Failed',
        message: exportResult.error,
        color: 'red',
      })
    }

    dispatch('feClearExportResult')
  }, [exportResult, dispatch])

  useEffect(() => {
    if (!importResult) return

    if (importResult.success && importResult.name) {
      notifications.show({
        title: 'Flow Imported',
        message: `"${importResult.name}" was added to your library`,
        color: 'green',
      })
    } else if (importResult.error) {
      notifications.show({
        title: 'Import Failed',
        message: importResult.error,
        color: 'red',
      })
    }

    dispatch('feClearImportResult')
  }, [importResult, dispatch])

  useEffect(() => {
    registerMenuHandlers()
    return () => {
      unregisterMenuHandlers()
    }
  }, [])

  const renderView = useCallback(() => {
    switch (currentView) {
      case 'agent':
        return <AgentView />
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
        return <AgentView />
    }
  }, [currentView])

  if (appBootstrapping) {
    return <LoadingScreen message={startupMessage} />
  }

  return (
    <Profiler
      id="App"
      onRender={(_id, _phase, actualDuration) => {
        if (actualDuration > 16) {
          // eslint-disable-next-line no-console
          console.debug('[perf] App render exceeded 16ms:', actualDuration)
        }
      }}
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

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <ActivityBar />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{renderView()}</div>
          </div>
          <StatusBar />
        </div>
      </div>
    </Profiler>
  )
}

export default App
