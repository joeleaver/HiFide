# Zustand to Services Quick Reference

## Before & After Comparison

### State Definition

**Before (Zustand):**
```typescript
export interface MySlice {
  value: string
  count: number
  setValue: (params: { value: string }) => void
  increment: () => void
}

export const createMySlice: StateCreator<MySlice> = (set, get) => ({
  value: '',
  count: 0,
  setValue: ({ value }) => set({ value }),
  increment: () => set((state) => ({ count: state.count + 1 }))
})
```

**After (Service):**
```typescript
interface MyState {
  value: string
  count: number
}

export class MyService extends Service<MyState> {
  constructor() {
    super({ value: '', count: 0 }, 'my-service')
  }
  
  setValue(value: string): void {
    this.setState({ value })
  }
  
  increment(): void {
    this.setState({ count: this.state.count + 1 })
  }
  
  protected onStateChange(updates: Partial<MyState>): void {
    // Persist and notify
    if (updates.value) this.persistence.save('value', updates.value)
    if (updates.count) this.persistence.save('count', updates.count)
    broadcastNotification('my.changed', updates)
  }
}
```

### Cross-Slice Dependencies

**Before (Zustand):**
```typescript
export const createSliceA: StateCreator<SliceA> = (set, get) => ({
  doSomething: () => {
    const sliceBValue = (get() as any).sliceBField
    ;(get() as any).sliceBAction()
  }
})
```

**After (Service):**
```typescript
export class ServiceA extends Service<StateA> {
  constructor(private serviceB: ServiceB) {
    super(initialState)
  }
  
  doSomething(): void {
    const value = this.serviceB.getState().field
    this.serviceB.action()
  }
}

// In registry setup:
const serviceB = new ServiceB()
const serviceA = new ServiceA(serviceB)
registry.register('serviceA', serviceA)
```

### Async Operations

**Before (Zustand):**
```typescript
fetchData: async ({ id }) => {
  set({ loading: true })
  try {
    const data = await api.fetch(id)
    set({ data, loading: false })
  } catch (error) {
    set({ error: String(error), loading: false })
  }
}
```

**After (Service):**
```typescript
async fetchData(id: string): Promise<void> {
  this.setState({ loading: true })
  try {
    const data = await api.fetch(id)
    this.setState({ data, loading: false })
  } catch (error) {
    this.setState({ error: String(error), loading: false })
  }
}
```

### Persistence

**Before (Zustand):**
```typescript
// Automatic via persist middleware
const store = persist(
  createSlice,
  {
    name: 'hifide-store',
    partialize: (state) => ({ value: state.value })
  }
)
```

**After (Service):**
```typescript
protected onStateChange(updates: Partial<MyState>): void {
  // Explicit persistence
  if (updates.value) {
    this.persistence.save('value', updates.value)
  }
}

// Or load in constructor:
constructor() {
  const value = this.persistence.load('value', 'default')
  super({ value }, 'my-service')
}
```

### Notifications to Renderer

**Before (Zustand):**
```typescript
// Automatic via zubridge
set({ value: newValue })
// Renderer automatically receives update
```

**After (Service):**
```typescript
protected onStateChange(updates: Partial<MyState>): void {
  // Explicit notification
  broadcastWorkspaceNotification(
    workspaceId,
    'my.value.changed',
    { value: updates.value }
  )
}
```

### JSON-RPC Handlers

**Before:**
```typescript
addMethod('my.getValue', async () => {
  const st: any = useMainStore.getState()
  return { ok: true, value: st.value }
})
```

**After:**
```typescript
addMethod('my.getValue', async () => {
  const service = registry.get<MyService>('my')
  return { ok: true, value: service.getState().value }
})

addMethod('my.setValue', async ({ value }: { value: string }) => {
  const service = registry.get<MyService>('my')
  service.setValue(value)
  return { ok: true }
})
```

## Migration Checklist

For each slice:

- [ ] Create `electron/services/[Name]Service.ts`
- [ ] Define state interface (no actions)
- [ ] Extend `Service<TState>` base class
- [ ] Convert actions to methods (remove `params:` wrapper)
- [ ] Implement `onStateChange()` for persistence/notifications
- [ ] Update JSON-RPC handlers in `ws/server.ts`
- [ ] Register service in `ServiceRegistry`
- [ ] Test all functionality
- [ ] Remove old slice file
- [ ] Update imports

## Common Patterns

### Pattern: No Persistence Needed
```typescript
constructor() {
  super(initialState) // No persist key
}

protected onStateChange(): void {
  // No persistence, maybe just notifications
}
```

### Pattern: Selective Persistence
```typescript
protected onStateChange(updates: Partial<MyState>): void {
  // Only persist certain fields
  if (updates.importantField) {
    this.persistence.save('importantField', updates.importantField)
  }
  // Don't persist transient fields
}
```

### Pattern: Workspace-Scoped State
```typescript
interface MyState {
  dataByWorkspace: Record<string, Data>
}

setDataForWorkspace(workspaceId: string, data: Data): void {
  this.setState({
    dataByWorkspace: {
      ...this.state.dataByWorkspace,
      [workspaceId]: data
    }
  })
}
```

