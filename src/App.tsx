import { useEffect, Profiler } from 'react'
import { Button, Group, Title } from '@mantine/core'
import { useAppStore, selectCurrentView, initializeStore } from './store'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import AgentView from './components/AgentView'
import ExplorerView from './components/ExplorerView'
import SourceControlView from './components/SourceControlView'
import SettingsPane from './SettingsPane'
import LoadingScreen from './components/LoadingScreen'

// Menu event handlers - defined once at module level
const menuHandlers = {
  openSettings: () => {
    useAppStore.getState().setCurrentView('settings')
  },
  openChat: () => {
    useAppStore.getState().setCurrentView('agent')
  },
  toggleTerminalPanel: () => {
    const s = useAppStore.getState()
    s.setCurrentView('explorer')
    s.setExplorerTerminalPanelOpen(!s.explorerTerminalPanelOpen)
  },
  openFolder: async () => {
    const result = await window.workspace?.openFolderDialog?.()
    if (result?.ok && result.path) {
      await useAppStore.getState().openFolder(result.path)
    }
  },
  openRecentFolder: async (_e: any, folderPath: string) => {
    await useAppStore.getState().openFolder(folderPath)
  },
  clearRecentFolders: () => {
    useAppStore.getState().clearRecentFolders()
  }
}

// Track if handlers are registered to prevent duplicates
let handlersRegistered = false

function App() {
  // Use selector for better performance
  const currentView = useAppStore(selectCurrentView)
  const appBootstrapping = useAppStore((s) => s.appBootstrapping)
  const startupMessage = useAppStore((s) => s.startupMessage)

  // Expose store to window for debugging
  useEffect(() => {
    (window as any).debugStore = useAppStore
  }, [])

  // Register menu handlers once
  if (!handlersRegistered && window.ipcRenderer) {
    handlersRegistered = true
    window.ipcRenderer.on('menu:open-settings', menuHandlers.openSettings)
    window.ipcRenderer.on('menu:open-chat', menuHandlers.openChat)
    window.ipcRenderer.on('menu:toggle-terminal-panel', menuHandlers.toggleTerminalPanel)
    window.ipcRenderer.on('menu:open-folder', menuHandlers.openFolder)
    window.ipcRenderer.on('menu:open-recent-folder', menuHandlers.openRecentFolder)
    window.ipcRenderer.on('menu:clear-recent-folders', menuHandlers.clearRecentFolders)
  }

  // Initialize store on first mount
  useEffect(() => {
    void initializeStore()
  }, [])


  // Keep main-process menu state in sync with current view (for enabling/disabling items)
  useEffect(() => {
    window.ipcRenderer?.invoke('app:set-view', currentView)
  }, [currentView])
  // Single source of truth: presence comes from main via IPC; subscribe and seed once
  useEffect(() => {
    // Subscribe
    const off = window.secrets?.onPresenceChanged?.((p) => {
      useAppStore.getState().setProvidersValid({ openai: !!p.openai, anthropic: !!p.anthropic, gemini: !!p.gemini })
      // Refresh models whenever provider presence changes
      try { void useAppStore.getState().refreshAllModels() } catch {}
    })
    // Seed
    ;(async () => {
      try {
        const p = await window.secrets?.presence?.()
        if (p) {
          useAppStore.getState().setProvidersValid({ openai: !!p.openai, anthropic: !!p.anthropic, gemini: !!p.gemini })
        }
      } catch {}
    })()
    return () => { try { off && off() } catch {} }
  }, [])



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
      onRender={(id, phase, actualDuration) => {
        if (actualDuration > 16) {
          console.log(`[Profiler] ${id} ${phase}: ${actualDuration.toFixed(2)}ms`)
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
              src="/hifide-logo.png"
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
                  window.ipcRenderer?.invoke('menu:popup', { menu: name, x: rect.left, y: rect.bottom })
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
            onClick={() => window.ipcRenderer.invoke('window:minimize')}
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
            onClick={() => window.ipcRenderer.invoke('window:maximize')}
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
            onClick={() => window.ipcRenderer.invoke('window:close')}
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

          {startupMessage && currentView === 'settings' && (
            <div style={{ padding: '8px 12px', backgroundColor: '#3a2b2b', color: '#ffffff', borderBottom: '1px solid #3e3e42' }}>
              {startupMessage}
            </div>
          )}

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
