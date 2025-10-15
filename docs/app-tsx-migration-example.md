# App.tsx Migration Example

This document shows how to update `src/App.tsx` to use the new modular store.

## Current Code (Old Store)

```typescript
import { useAppStore } from './store/app'

function App() {
  const currentView = useAppStore((s) => s.currentView)
  const appBootstrapping = useAppStore((s) => s.appBootstrapping)
  const startupMessage = useAppStore((s) => s.startupMessage)
  const initializeApp = useAppStore((s) => s.initializeApp)
  
  useEffect(() => {
    void initializeApp()
  }, [initializeApp])
  
  // ... rest of component
}
```

## New Code (New Store)

```typescript
import { useAppStore, selectCurrentView, initializeStore } from './store'

function App() {
  // Use selectors for better performance
  const currentView = useAppStore(selectCurrentView)
  const appBootstrapping = useAppStore((s) => s.appBootstrapping)
  const startupMessage = useAppStore((s) => s.startupMessage)
  
  // Initialize store on mount
  useEffect(() => {
    void initializeStore()
  }, [])
  
  // ... rest of component
}
```

## Key Changes

1. **Import Path**: Changed from `'./store/app'` to `'./store'`
2. **Selectors**: Use exported selectors like `selectCurrentView`
3. **Initialization**: Use `initializeStore()` instead of `initializeApp()`

## Full Migration Steps

### Step 1: Update Import
```typescript
// Before
import { useAppStore } from './store/app'

// After
import { useAppStore, selectCurrentView, initializeStore } from './store'
```

### Step 2: Update Selectors
```typescript
// Before
const currentView = useAppStore((s) => s.currentView)

// After (recommended)
const currentView = useAppStore(selectCurrentView)

// Or (still works)
const currentView = useAppStore((s) => s.currentView)
```

### Step 3: Update Initialization
```typescript
// Before
const initializeApp = useAppStore((s) => s.initializeApp)
useEffect(() => {
  void initializeApp()
}, [initializeApp])

// After
useEffect(() => {
  void initializeStore()
}, [])
```

## Menu Handlers

Menu handlers work the same way:

```typescript
const menuHandlers = {
  openSettings: () => {
    useAppStore.getState().setCurrentView('settings')
  },
  openChat: () => {
    useAppStore.getState().setCurrentView('agent')
  },
  // ... etc
}
```

No changes needed for menu handlers!

## Complete Example

Here's a complete example of the updated App.tsx:

```typescript
import { useEffect } from 'react'
import { Button, Group, Title } from '@mantine/core'
import { 
  useAppStore, 
  selectCurrentView,
  initializeStore 
} from './store'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import AgentView from './components/AgentView'
import ExplorerView from './components/ExplorerView'
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
  // Use selectors for better performance
  const currentView = useAppStore(selectCurrentView)
  const appBootstrapping = useAppStore((s) => s.appBootstrapping)
  const startupMessage = useAppStore((s) => s.startupMessage)

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

  // Keep main-process menu state in sync with current view
  useEffect(() => {
    window.ipcRenderer?.invoke('app:set-view', currentView)
  }, [currentView])
  
  // Subscribe to provider presence changes
  useEffect(() => {
    const off = window.secrets?.onPresenceChanged?.((p) => {
      useAppStore.getState().setProvidersValid({ 
        openai: !!p.openai, 
        anthropic: !!p.anthropic, 
        gemini: !!p.gemini 
      })
      try { 
        void useAppStore.getState().refreshAllModels() 
      } catch {}
    })
    
    // Seed initial presence
    ;(async () => {
      try {
        const p = await window.secrets?.presence?.()
        if (p) {
          useAppStore.getState().setProvidersValid({ 
            openai: !!p.openai, 
            anthropic: !!p.anthropic, 
            gemini: !!p.gemini 
          })
        }
      } catch {}
    })()
    
    return () => { 
      try { 
        off && off() 
      } catch {} 
    }
  }, [])

  // Render loading screen during bootstrap
  if (appBootstrapping) {
    return <LoadingScreen message={startupMessage} />
  }

  // Render the appropriate view
  const renderView = () => {
    switch (currentView) {
      case 'agent':
        return <AgentView />
      case 'explorer':
        return <ExplorerView />
      case 'settings':
        return <SettingsPane />
      default:
        return <AgentView />
    }
  }

  return (
    <div className="app">
      <ActivityBar />
      <div className="main-content">
        {renderView()}
      </div>
      <StatusBar />
    </div>
  )
}

export default App
```

## Testing the Migration

After updating App.tsx:

1. **Check for TypeScript errors**: `npm run type-check`
2. **Start the app**: `npm run dev`
3. **Test basic functionality**:
   - App loads without errors
   - Can switch between views
   - Settings load correctly
   - Sessions work
   - Terminal works

## Rollback Plan

If issues occur, you can temporarily rollback:

1. Change import back to `'./store/app'`
2. Revert initialization to `initializeApp()`
3. File a bug report with details

## Next Steps

After App.tsx is migrated:

1. Update other components one by one
2. Use selectors for better performance
3. Test thoroughly
4. Remove old `store/app.ts` file

## Questions?

See the [Migration Guide](./store-migration-guide.md) for more details.

