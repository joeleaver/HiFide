---
type: "always_apply"
---

# Zustand + Zubridge Architecture Patterns

This document describes the correct patterns for using Zustand with @zubridge/electron in the HiFide application.

## Architecture Overview

HiFide uses a **main-process-owned Zustand store** that is synchronized to renderer processes via `@zubridge/electron`. This architecture ensures:
- Single source of truth in the main process
- Automatic IPC synchronization to all renderer windows
- Type-safe state access and mutations
- Persistence via electron-store (main process only)

## Key Concepts

### Main Process (electron/store/)
- **Owns the store**: The Zustand store lives in the main process
- **Handles persistence**: Uses `persist` middleware with electron-store
- **Executes all actions**: All state mutations happen here
- **Broadcasts changes**: Zubridge automatically syncs state to renderers

### Renderer Process (src/)
- **Reads state**: Gets a synchronized copy of the store
- **Dispatches actions**: Sends action calls to main process via IPC
- **Cannot mutate directly**: All mutations must go through dispatch

## Critical Rules

### 1. Action Signatures Must Use Single Object Parameters

**❌ WRONG - Multiple parameters don't work with dispatch():**
```typescript
// Type definition
setDefaultModel: (provider: string, model: string) => void

// Renderer call - FAILS because dispatch passes args separately
dispatch('setDefaultModel', 'openai', 'gpt-4')
```

**✅ CORRECT - Single object parameter:**
```typescript
// Type definition
setDefaultModel: (params: { provider: string; model: string }) => void

// Implementation
setDefaultModel: ({ provider, model }: { provider: string; model: string }) => {
  set((state) => ({
    defaultModels: { ...state.defaultModels, [provider]: model }
  }))
}

// Renderer call - WORKS
dispatch('setDefaultModel', { provider: 'openai', model: 'gpt-4' })
```

### 2. Renderer Components Must Use useDispatch()

**❌ WRONG - Cannot extract actions from store:**
```typescript
// This doesn't work in zubridge
const setSelectedModel = useAppStore((s) => s.setSelectedModel)
setSelectedModel('gpt-4')
```

**✅ CORRECT - Use dispatch hook:**
```typescript
import { useDispatch } from '@/store'

function MyComponent() {
  const dispatch = useDispatch()
  
  const handleChange = (model: string) => {
    dispatch('setSelectedModel', model)
  }
}
```

### 3. Reading State in Renderer

**✅ CORRECT - Use selectors:**
```typescript
import { useAppStore } from '@/store'

function MyComponent() {
  // Read individual values
  const model = useAppStore((s) => s.selectedModel)
  const provider = useAppStore((s) => s.selectedProvider)
  
  // Or use pre-defined selectors
  const sessions = useAppStore(selectSessions)
}
```

### 4. Persistence Happens Automatically

**❌ WRONG - Don't call localStorage functions:**
```typescript
// These are NO-OPS in the main process
setInLocalStorage(LS_KEYS.SELECTED_MODEL, model)
getFromLocalStorage(LS_KEYS.SELECTED_MODEL, 'gpt-4')
```

**✅ CORRECT - Let persist middleware handle it:**
```typescript
// In electron/store/index.ts, configure what to persist
const persistedStore = persist(
  (...args) => ({
    ...createViewSlice(...args),
    ...createProviderSlice(...args),
    // ... other slices
  }),
  {
    name: 'hifide-store',
    storage: createJSONStorage(() => electronStorage),
    partialize: (state) => ({
      // Only these fields are persisted
      selectedModel: state.selectedModel,
      selectedProvider: state.selectedProvider,
      defaultModels: state.defaultModels,
      // ...
    })
  }
)

// In slice, just set state - persistence is automatic
setSelectedModel: (model: string) => {
  set({ selectedModel: model })
  // No manual persistence needed!
}
```

### 5. Internal Main Process Calls Don't Need Object Wrapping

Actions called **within the main process** (slice-to-slice) can use any signature:

```typescript
// This is fine for internal calls
refreshModels: async (provider: 'openai' | 'anthropic' | 'gemini') => {
  // ... fetch models ...
  
  // Internal call - can use multiple params
  get().setModelsForProvider({ provider, models })
}
```

Only actions called from the **renderer via dispatch()** need single object parameters.

## Common Patterns

### Pattern 1: Simple State Update
```typescript
// Slice definition
export interface MySlice {
  value: string
  setValue: (value: string) => void
}

export const createMySlice: StateCreator<MySlice> = (set) => ({
  value: '',
  setValue: (value: string) => set({ value })
})

// Renderer usage
const dispatch = useDispatch()
dispatch('setValue', 'new value')
```

### Pattern 2: Multi-Parameter Action
```typescript
// Slice definition
export interface MySlice {
  items: Record<string, Item>
  updateItem: (params: { id: string; data: Partial<Item> }) => void
}

export const createMySlice: StateCreator<MySlice> = (set) => ({
  items: {},
  updateItem: ({ id, data }: { id: string; data: Partial<Item> }) => {
    set((state) => ({
      items: {
        ...state.items,
        [id]: { ...state.items[id], ...data }
      }
    }))
  }
})

// Renderer usage
const dispatch = useDispatch()
dispatch('updateItem', { id: '123', data: { name: 'Updated' } })
```

### Pattern 3: Async Action with Results
**IMPORTANT**: In zubridge, `dispatch()` does NOT return the action's return value. Instead, use state fields to communicate results.

```typescript
// Slice definition
export interface MySlice {
  loading: boolean
  data: Data | null
  fetchResult: { ok: boolean; error?: string } | null
  fetchData: (params: { id: string }) => Promise<void>
  clearFetchResult: () => void
}

export const createMySlice: StateCreator<MySlice> = (set, get) => ({
  loading: false,
  data: null,
  fetchResult: null,

  fetchData: async ({ id }: { id: string }) => {
    set({ loading: true, fetchResult: null })
    try {
      const data = await api.fetch(id)
      set({
        data,
        loading: false,
        fetchResult: { ok: true }
      })
    } catch (error) {
      set({
        loading: false,
        fetchResult: { ok: false, error: String(error) }
      })
    }
  },

  clearFetchResult: () => {
    set({ fetchResult: null })
  }
})

// Renderer usage - use reactive state, not return values
const dispatch = useDispatch()
const fetchResult = useAppStore((s) => s.fetchResult)

// Trigger the action
const handleFetch = async () => {
  dispatch('clearFetchResult')
  await dispatch('fetchData', { id: '123' })
}

// React to the result
useEffect(() => {
  if (!fetchResult) return

  if (fetchResult.ok) {
    notifications.show({ message: 'Success!' })
  } else {
    notifications.show({ message: fetchResult.error })
  }
}, [fetchResult])
```

### Pattern 4: Cross-Slice Communication
```typescript
// In main process, slices can call each other
export const createProviderSlice: StateCreator<ProviderSlice> = (set, get) => ({
  setSelectedProvider: (provider: string) => {
    set({ selectedProvider: provider })
    
    // Call another slice's action
    const state = get() as any
    if (state.ensureProviderModelConsistency) {
      state.ensureProviderModelConsistency()
    }
  }
})
```

## Migration Checklist

When adding a new action or fixing an existing one:

1. ✅ **Check if called from renderer** - Search for `dispatch('actionName'` in `src/`
2. ✅ **Use object parameter** - If called from renderer, signature must be `(params: { ... }) => void`
3. ✅ **Update implementation** - Destructure the params object
4. ✅ **Update all call sites** - Change `dispatch('action', arg1, arg2)` to `dispatch('action', { arg1, arg2 })`
5. ✅ **Remove manual persistence** - Delete any `setInLocalStorage` or `getFromLocalStorage` calls
6. ✅ **Configure partialize** - Add fields to persist config in `electron/store/index.ts`

## File Structure

```
electron/store/
├── index.ts              # Main store creation, persist config
├── types.ts              # Shared types
├── slices/               # Individual slice files
│   ├── provider.slice.ts
│   ├── session.slice.ts
│   └── ...
└── utils/
    ├── constants.ts      # Constants (MAX_SESSIONS, etc.)
    └── persistence.ts    # NO-OP stubs for main process

src/store/
├── index.ts              # Renderer bridge setup
└── bridge.ts             # Zubridge configuration
```

## Debugging Tips

### Issue: "Action is not a function"
**Cause**: Trying to extract action from store in renderer
**Fix**: Use `useDispatch()` instead

### Issue: "Expected 1 argument but got 2"
**Cause**: Action has multiple parameters but is called with dispatch
**Fix**: Change signature to accept single object parameter

### Issue: "State not persisting"
**Cause**: Field not in `partialize` config or using manual localStorage
**Fix**: Add field to `partialize` in `electron/store/index.ts`

### Issue: "Type error in slice"
**Cause**: Mismatch between type definition and implementation
**Fix**: Ensure both use same signature (object parameter if called from renderer)

## References

- Zustand docs: https://github.com/pmndrs/zustand
- @zubridge/electron: https://github.com/wobsoriano/zubridge
- electron-store: https://github.com/sindresorhus/electron-store

