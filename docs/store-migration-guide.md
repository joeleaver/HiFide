# Store Migration Guide

This guide explains how to migrate from the old monolithic `app.ts` store to the new modular slice-based store.

## Overview

The new store architecture uses **Zustand slices pattern** to organize state into focused, maintainable modules.

### Benefits
- ✅ **Modular** - Each slice focuses on a specific domain
- ✅ **Type-Safe** - Full TypeScript support throughout
- ✅ **Maintainable** - Easy to understand and modify
- ✅ **Testable** - Each slice can be tested independently
- ✅ **Performant** - Optimized selectors prevent unnecessary re-renders

---

## Quick Start

### Before (Old Store)
```typescript
import { useAppStore } from '@/store/app'

function MyComponent() {
  const currentView = useAppStore((state) => state.currentView)
  const setCurrentView = useAppStore((state) => state.setCurrentView)
  
  return <div>...</div>
}
```

### After (New Store)
```typescript
import { useAppStore, selectCurrentView } from '@/store'

function MyComponent() {
  // Option 1: Use selector (recommended for performance)
  const currentView = useAppStore(selectCurrentView)
  
  // Option 2: Access directly
  const { setCurrentView } = useAppStore()
  
  return <div>...</div>
}
```

---

## Import Changes

### Old Import
```typescript
import { useAppStore } from '@/store/app'
```

### New Import
```typescript
// Import store and selectors
import { useAppStore, selectCurrentView, selectCurrentSession } from '@/store'

// Import types if needed
import type { Session, ChatMessage, TokenUsage } from '@/store'
```

---

## Using Selectors

Selectors are **recommended** for better performance. They prevent unnecessary re-renders.

### Available Selectors

#### View
```typescript
import { selectCurrentView } from '@/store'

const currentView = useAppStore(selectCurrentView)
```

#### Session
```typescript
import { 
  selectCurrentSession,
  selectCurrentMessages,
  selectSessions,
  selectCurrentId 
} from '@/store'

const session = useAppStore(selectCurrentSession)
const messages = useAppStore(selectCurrentMessages)
const sessions = useAppStore(selectSessions)
const currentId = useAppStore(selectCurrentId)
```

#### Provider
```typescript
import { 
  selectSelectedProvider,
  selectSelectedModel,
  selectProviderValid,
  selectModelsByProvider 
} from '@/store'

const provider = useAppStore(selectSelectedProvider)
const model = useAppStore(selectSelectedModel)
const providerValid = useAppStore(selectProviderValid)
const models = useAppStore(selectModelsByProvider)
```

#### Workspace
```typescript
import { selectWorkspaceRoot, selectRecentFolders } from '@/store'

const workspaceRoot = useAppStore(selectWorkspaceRoot)
const recentFolders = useAppStore(selectRecentFolders)
```

#### Terminal
```typescript
import { 
  selectAgentTerminalTabs,
  selectAgentActiveTerminal,
  selectExplorerTerminalTabs,
  selectExplorerActiveTerminal 
} from '@/store'

const agentTabs = useAppStore(selectAgentTerminalTabs)
const activeAgent = useAppStore(selectAgentActiveTerminal)
```

#### UI
```typescript
import { 
  selectMetaPanelOpen,
  selectSidebarCollapsed,
  selectDebugPanelCollapsed 
} from '@/store'

const metaPanelOpen = useAppStore(selectMetaPanelOpen)
const sidebarCollapsed = useAppStore(selectSidebarCollapsed)
```

#### Other
```typescript
import { 
  selectExplorerTree,
  selectOpenedFile,
  selectIndexStatus,
  selectIndexProgress,
  selectDebugLogs,
  selectApprovedPlan,
  selectAutoApproveEnabled,
  selectPricingConfig,
  selectCurrentRequestId,
  selectStreamingText 
} from '@/store'
```

---

## Accessing Actions

Actions are accessed the same way as before:

```typescript
import { useAppStore } from '@/store'

function MyComponent() {
  const { 
    addUserMessage,
    addAssistantMessage,
    newSession,
    setCurrentView,
    openFolder,
    setSelectedProvider 
  } = useAppStore()
  
  const handleClick = () => {
    addUserMessage('Hello!')
  }
  
  return <button onClick={handleClick}>Send</button>
}
```

---

## Common Patterns

### Pattern 1: Read State + Call Action
```typescript
function ChatInput() {
  const currentId = useAppStore(selectCurrentId)
  const { addUserMessage } = useAppStore()
  
  const handleSubmit = (text: string) => {
    if (!currentId) return
    addUserMessage(text)
  }
  
  return <input onSubmit={handleSubmit} />
}
```

### Pattern 2: Multiple Selectors
```typescript
function SessionList() {
  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)
  const { select } = useAppStore()
  
  return (
    <ul>
      {sessions.map(session => (
        <li 
          key={session.id}
          className={session.id === currentId ? 'active' : ''}
          onClick={() => select(session.id)}
        >
          {session.title}
        </li>
      ))}
    </ul>
  )
}
```

### Pattern 3: Derived State
```typescript
function TokenUsageDisplay() {
  const session = useAppStore(selectCurrentSession)
  
  // Derive state from selector result
  const totalTokens = session?.tokenUsage.total.totalTokens ?? 0
  const totalCost = session?.costs.totalCost ?? 0
  
  return (
    <div>
      <p>Tokens: {totalTokens}</p>
      <p>Cost: ${totalCost.toFixed(4)}</p>
    </div>
  )
}
```

### Pattern 4: Custom Selector
```typescript
// Create custom selector for complex logic
const selectHasValidProvider = (state: AppStore) => 
  Object.values(state.providerValid).some(Boolean)

function ProviderStatus() {
  const hasValid = useAppStore(selectHasValidProvider)
  
  return <div>{hasValid ? 'Ready' : 'No valid provider'}</div>
}
```

---

## Initialization

The store must be initialized on app startup:

```typescript
// In your main App.tsx or index.tsx
import { initializeStore } from '@/store'

function App() {
  useEffect(() => {
    initializeStore()
  }, [])
  
  return <YourApp />
}
```

---

## Type Safety

All types are exported from the store:

```typescript
import type { 
  AppStore,
  Session,
  ChatMessage,
  TokenUsage,
  TokenCost,
  ModelOption,
  PtySession,
  ApprovedPlan,
  ViewType 
} from '@/store'

function MyComponent() {
  const session: Session | undefined = useAppStore(selectCurrentSession)
  const messages: ChatMessage[] = useAppStore(selectCurrentMessages)
  
  return <div>...</div>
}
```

---

## Testing

### Testing Components
```typescript
import { renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'

describe('MyComponent', () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      currentView: 'agent',
      sessions: [],
      currentId: null,
    })
  })
  
  it('should work', () => {
    const { result } = renderHook(() => useAppStore())
    
    expect(result.current.currentView).toBe('agent')
  })
})
```

---

## Migration Checklist

- [ ] Update imports from `@/store/app` to `@/store`
- [ ] Replace inline selectors with exported selectors
- [ ] Add `initializeStore()` call to app entry point
- [ ] Update type imports
- [ ] Test all components
- [ ] Remove old `app.ts` file (after migration complete)

---

## Troubleshooting

### Issue: "Cannot find module '@/store'"
**Solution:** Make sure you're importing from `@/store` not `@/store/app`

### Issue: "Property X does not exist on type AppStore"
**Solution:** Check that all slices are properly integrated in `src/store/index.ts`

### Issue: "Component re-renders too often"
**Solution:** Use selectors instead of accessing state directly:
```typescript
// ❌ Bad - causes re-renders
const state = useAppStore()
const view = state.currentView

// ✅ Good - optimized
const view = useAppStore(selectCurrentView)
```

### Issue: "Store not initialized"
**Solution:** Make sure `initializeStore()` is called on app startup

---

## Performance Tips

1. **Use Selectors** - Always use selectors for better performance
2. **Avoid Inline Functions** - Define selectors outside components
3. **Memoize Derived State** - Use `useMemo` for complex computations
4. **Split Components** - Break large components into smaller ones

---

## Need Help?

- Check the [Store README](../src/store/slices/README.md)
- Review the [Integration Tests](../src/store/__tests__/integration.test.ts)
- Look at existing components for examples

---

## Summary

The new store is:
- ✅ More modular and maintainable
- ✅ Fully type-safe
- ✅ Better performance with selectors
- ✅ Easier to test
- ✅ Well-documented

Migration is straightforward - just update imports and use selectors!

