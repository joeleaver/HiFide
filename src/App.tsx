import { useEffect } from 'react'
import { Button, Group, Title } from '@mantine/core'
import { useAppStore } from './store/app'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import AgentView from './components/AgentView'
import ExplorerView from './components/ExplorerView'
import SourceControlView from './components/SourceControlView'
import SettingsPane from './SettingsPane'

function App() {
  const currentView = useAppStore((s) => s.currentView)
  const setCurrentView = useAppStore((s) => s.setCurrentView)

  // Respond to App Menu navigation
  useEffect(() => {
    const openSettings = () => setCurrentView('settings')
    const openChat = () => setCurrentView('agent')
    const toggleTerminalPanel = () => {
      // Ensure Explorer view is active so the panel is mounted
      setCurrentView('explorer')
      const s = useAppStore.getState()
      s.setExplorerTerminalPanelOpen(!s.explorerTerminalPanelOpen)
    }
    window.ipcRenderer?.on('menu:open-settings', openSettings)
    window.ipcRenderer?.on('menu:open-chat', openChat)
    window.ipcRenderer?.on('menu:toggle-terminal-panel', toggleTerminalPanel)
    return () => {
      window.ipcRenderer?.off('menu:open-settings', openSettings)
      window.ipcRenderer?.off('menu:open-chat', openChat)
      window.ipcRenderer?.off('menu:toggle-terminal-panel', toggleTerminalPanel)
    }
  }, [setCurrentView])

  // Keep main-process menu state in sync with current view (for enabling/disabling items)
  useEffect(() => {
    window.ipcRenderer?.invoke('app:set-view', currentView)
  }, [currentView])
  // Bootstrap provider validation from keytar OR env (so saved keys and env keys both show as validated)
  useEffect(() => {
    (async () => {
      try {
        const presence = await window.secrets?.presence?.()
        if (presence && typeof presence === 'object') {
          useAppStore.getState().setProvidersValid({
            openai: !!presence.openai,
            anthropic: !!presence.anthropic,
            gemini: !!presence.gemini,
          })
          return
        }
      } catch {}
      // Fallback to keytar-only
      try {
        const openaiKey = await window.secrets?.getApiKey?.()
        const anthropicKey = await window.secrets?.getApiKeyFor?.('anthropic')
        const geminiKey = await window.secrets?.getApiKeyFor?.('gemini')
        useAppStore.getState().setProvidersValid({
          openai: !!(openaiKey && openaiKey.trim()),
          anthropic: !!(anthropicKey && anthropicKey.trim()),
          gemini: !!(geminiKey && geminiKey.trim()),
        })
      } catch {}
    })()
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

  return (
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

      {/* Main Content Area */}
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
  )
}

export default App
