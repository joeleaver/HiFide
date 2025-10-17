# Store Slices

This directory contains Zustand store slices following the official [slices pattern](https://docs.pmnd.rs/zustand/guides/slices-pattern).

## 📁 Structure

```
slices/
├── view.slice.ts          # Current view state ✅
├── ui.slice.ts            # UI panel states ✅
├── debug.slice.ts         # Debug logging ✅
├── planning.slice.ts      # Approved plans ✅
├── app.slice.ts           # App initialization ✅
├── workspace.slice.ts     # Workspace management ✅
├── explorer.slice.ts      # File explorer ✅
├── indexing.slice.ts      # Code indexing ✅
├── provider.slice.ts      # Provider/model selection ✅
├── settings.slice.ts      # Settings & API keys ✅
├── terminal.slice.ts      # Terminal & PTY management ✅
├── session.slice.ts       # Chat sessions & LLM lifecycle ✅
├── provider.slice.ts      # Model/provider selection (TODO)
├── settings.slice.ts      # Settings (TODO)
├── terminal.slice.ts      # Terminal/PTY (TODO)
├── session.slice.ts       # Chat sessions (TODO)
└── __tests__/             # Tests for each slice
```

## 🎯 Slice Pattern

Each slice follows this structure:

```typescript
/**
 * [Name] Slice
 * 
 * [Description of responsibilities]
 */

import type { StateCreator } from 'zustand'
import type { /* types */ } from '../types'
import { LS_KEYS, DEFAULTS } from '../utils/constants'
import { getFromLocalStorage, setInLocalStorage } from '../utils/persistence'

// ============================================================================
// Types
// ============================================================================

export interface [Name]Slice {
  // State
  someState: SomeType
  
  // Actions
  someAction: () => void
}

// ============================================================================
// Slice Creator
// ============================================================================

export const create[Name]Slice: StateCreator<[Name]Slice> = (set, get) => ({
  // Initialize state
  someState: getFromLocalStorage(LS_KEYS.SOME_KEY, DEFAULTS.SOME_DEFAULT),
  
  // Implement actions
  someAction: () => {
    set({ someState: newValue })
    setInLocalStorage(LS_KEYS.SOME_KEY, newValue)
  },
})
```

## 🔗 Cross-Slice Communication

Slices can access other slices' state and actions using `get()`:

```typescript
export const createSliceA: StateCreator<SliceA> = (set, get) => ({
  someAction: () => {
    // Access another slice's state
    const sliceBValue = (get() as any).sliceBField
    
    // Call another slice's action
    ;(get() as any).sliceBAction()
  },
})
```

**Note:** Type safety for cross-slice access will be provided by the combined store type.

## 💾 Persistence

Slices use the persistence utilities for localStorage:

```typescript
import { getFromLocalStorage, setInLocalStorage } from '../utils/persistence'

// Read from localStorage
const value = getFromLocalStorage<Type>(LS_KEYS.SOME_KEY, defaultValue)

// Write to localStorage
setInLocalStorage(LS_KEYS.SOME_KEY, value)
```

## 🧪 Testing

Each slice should have corresponding tests in `__tests__/`:

```typescript
import { create } from 'zustand'
import { createMySlice, type MySlice } from '../my.slice'

describe('MySlice', () => {
  let store: ReturnType<typeof create<MySlice>>
  
  beforeEach(() => {
    store = create<MySlice>()(createMySlice)
  })
  
  it('should do something', () => {
    // Test implementation
  })
})
```

## 📝 Guidelines

### DO:
✅ Keep slices focused on a single domain  
✅ Use TypeScript for type safety  
✅ Persist important state to localStorage  
✅ Write tests for each slice  
✅ Document responsibilities clearly  
✅ Use constants for localStorage keys  
✅ Use utility functions for persistence  

### DON'T:
❌ Mix multiple domains in one slice  
❌ Directly access localStorage (use utilities)  
❌ Hardcode localStorage keys (use constants)  
❌ Skip tests  
❌ Create circular dependencies  
❌ Mutate state directly (use `set()`)  

## 🚀 Adding a New Slice

1. **Create the slice file** in `src/store/slices/[name].slice.ts`
2. **Define the interface** with state and actions
3. **Implement the slice creator** using `StateCreator`
4. **Add localStorage keys** to `utils/constants.ts` if needed
5. **Add default values** to `utils/constants.ts` if needed
6. **Write tests** in `__tests__/[name].slice.test.ts`
7. **Add to combined store** in `src/store/index.ts` (when ready)

## 📚 Resources

- [Zustand Documentation](https://docs.pmnd.rs/zustand)
- [Slices Pattern Guide](https://docs.pmnd.rs/zustand/guides/slices-pattern)
- [TypeScript Guide](https://docs.pmnd.rs/zustand/guides/typescript)

## 🎯 Current Status

**Week 1: Foundation** ✅ COMPLETE
- [x] Directory structure
- [x] Shared types
- [x] Persistence utilities
- [x] Constants
- [x] View slice
- [x] UI slice
- [x] Debug slice
- [x] Test infrastructure
- [x] Documentation

**Week 2: Simple Slices** ⏳ (75% Complete)
- [x] View slice (done in Week 1)
- [x] UI slice (done in Week 1)
- [x] Debug slice (done in Week 1)
- [ ] Planning slice

**Week 3: Medium Slices** ✅ COMPLETE
- [x] App slice
- [x] Workspace slice
- [x] Explorer slice
- [x] Indexing slice

**Week 4: Complex Slices** (Next)
- [ ] Provider slice
- [ ] Settings slice
- [ ] Terminal slice
- [ ] Session slice

**Week 5: Integration** (Future)
- [ ] Combined store
- [ ] Migration from old store

**Week 6: Component Updates** (Future)
- [ ] Update all components

**Week 7: Testing & Cleanup** (Future)
- [ ] Comprehensive testing
- [ ] Remove old store file

