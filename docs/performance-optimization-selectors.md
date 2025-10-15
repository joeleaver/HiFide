# Performance Optimization: Zustand Selectors

## Problem

Components were experiencing excessive re-renders when typing in the chat input. Every keystroke was causing multiple components to re-render, leading to console log floods and poor performance.

## Root Cause

Several components were using `useAppStore()` without a selector function, which subscribes to **all** state changes in the store. This pattern:

```typescript
// ❌ BAD - Subscribes to ALL state changes
const {
  action1,
  action2,
  state1,
  state2,
} = useAppStore()
```

This meant that when `chatInput` changed on every keystroke, every component using this pattern would re-render, even if they didn't use `chatInput`.

## Solution

We fixed this by:

1. **Creating specific selectors** for commonly used state values
2. **Separating state subscriptions from action access** - actions don't cause re-renders
3. **Using selectors consistently** across all components

### Pattern

```typescript
// ✅ GOOD - Only subscribes to specific state
const state1 = useAppStore(selectState1)
const state2 = useAppStore(selectState2)

// Actions don't cause re-renders
const action1 = useAppStore((s) => s.action1)
const action2 = useAppStore((s) => s.action2)
```

## New Selectors Added

Added the following selectors to `src/store/index.ts`:

```typescript
// Context selectors
export const selectCtxRefreshing = (state: AppStore) => state.ctxRefreshing
export const selectCtxResult = (state: AppStore) => state.ctxResult
export const selectLastRequestSavings = (state: AppStore) => state.lastRequestSavings

// Explorer selectors
export const selectExplorerOpenFolders = (state: AppStore) => state.explorerOpenFolders
export const selectExplorerChildrenByDir = (state: AppStore) => state.explorerChildrenByDir
export const selectExplorerTerminalPanelOpen = (state: AppStore) => state.explorerTerminalPanelOpen
export const selectExplorerTerminalPanelHeight = (state: AppStore) => state.explorerTerminalPanelHeight

// Rate limit selectors
export const selectRateLimitConfig = (state: AppStore) => state.rateLimitConfig

// Settings selectors
export const selectAutoRetry = (state: AppStore) => state.autoRetry
export const selectAutoEnforceEditsSchema = (state: AppStore) => state.autoEnforceEditsSchema
export const selectSettingsApiKeys = (state: AppStore) => state.settingsApiKeys
export const selectSettingsSaving = (state: AppStore) => state.settingsSaving
export const selectSettingsSaved = (state: AppStore) => state.settingsSaved
export const selectStartupMessage = (state: AppStore) => state.startupMessage

// Agent metrics selectors
export const selectAgentMetrics = (state: AppStore) => state.agentMetrics
```

## Components Fixed

### 1. AgentView.tsx
**Before:**
```typescript
const {
  setMetaPanelOpen,
  select,
  ctxRefreshing,
  ctxResult,
  refreshContext,
  newSession,
  lastRequestTokenUsage: lastRequest,
  lastRequestSavings: lastSavings,
  calculateCost,
} = useAppStore()
```

**After:**
```typescript
// State - use selectors
const ctxRefreshing = useAppStore(selectCtxRefreshing)
const ctxResult = useAppStore(selectCtxResult)
const lastRequest = useAppStore(selectLastRequestTokenUsage)
const lastSavings = useAppStore(selectLastRequestSavings)

// Actions only - don't cause re-renders
const setMetaPanelOpen = useAppStore((s) => s.setMetaPanelOpen)
const select = useAppStore((s) => s.select)
const refreshContext = useAppStore((s) => s.refreshContext)
const newSession = useAppStore((s) => s.newSession)
const calculateCost = useAppStore((s) => s.calculateCost)
```

### 2. ExplorerView.tsx
**Before:**
```typescript
const {
  explorerOpenFolders: openFolders,
  explorerChildrenByDir: childrenByDir,
  toggleExplorerFolder,
  explorerTerminalPanelOpen,
  explorerTerminalPanelHeight,
  openFile,
} = useAppStore()
```

**After:**
```typescript
// State - use selectors
const openFolders = useAppStore(selectExplorerOpenFolders)
const childrenByDir = useAppStore(selectExplorerChildrenByDir)
const explorerTerminalPanelOpen = useAppStore(selectExplorerTerminalPanelOpen)
const explorerTerminalPanelHeight = useAppStore(selectExplorerTerminalPanelHeight)

// Actions only
const toggleExplorerFolder = useAppStore((s) => s.toggleExplorerFolder)
const openFile = useAppStore((s) => s.openFile)
```

### 3. PricingSettings.tsx
**Before:**
```typescript
const {
  pricingConfig,
  setPricingForModel,
  resetPricingToDefaults,
  resetProviderPricing,
} = useAppStore()
```

**After:**
```typescript
// State - use selector
const pricingConfig = useAppStore(selectPricingConfig)

// Actions only
const setPricingForModel = useAppStore((s) => s.setPricingForModel)
const resetPricingToDefaults = useAppStore((s) => s.resetPricingToDefaults)
const resetProviderPricing = useAppStore((s) => s.resetProviderPricing)
```

### 4. RateLimitSettings.tsx
**Before:**
```typescript
const {
  rateLimitConfig,
  loadRateLimitConfig,
  toggleRateLimiting,
} = useAppStore()
```

**After:**
```typescript
// State - use selector
const rateLimitConfig = useAppStore(selectRateLimitConfig)

// Actions only
const loadRateLimitConfig = useAppStore((s) => s.loadRateLimitConfig)
const toggleRateLimiting = useAppStore((s) => s.toggleRateLimiting)
```

### 5. SettingsPane.tsx
**Before:**
```typescript
const {
  autoRetry, setAutoRetry,
  setDefaultModel,
  autoApproveEnabled, setAutoApproveEnabled,
  autoApproveThreshold, setAutoApproveThreshold,
  autoEnforceEditsSchema, setAutoEnforceEditsSchema,
  settingsApiKeys, settingsSaving, settingsSaved,
  setSettingsApiKey, loadSettingsApiKeys, saveSettingsApiKeys,
  startupMessage,
} = useAppStore()
```

**After:**
```typescript
// State - use selectors
const autoRetry = useAppStore(selectAutoRetry)
const autoApproveEnabled = useAppStore(selectAutoApproveEnabled)
const autoApproveThreshold = useAppStore(selectAutoApproveThreshold)
const autoEnforceEditsSchema = useAppStore(selectAutoEnforceEditsSchema)
const settingsApiKeys = useAppStore(selectSettingsApiKeys)
const settingsSaving = useAppStore(selectSettingsSaving)
const settingsSaved = useAppStore(selectSettingsSaved)
const startupMessage = useAppStore(selectStartupMessage)

// Actions only
const setAutoRetry = useAppStore((s) => s.setAutoRetry)
const setDefaultModel = useAppStore((s) => s.setDefaultModel)
// ... etc
```

### 6. StatusBar.tsx
**Before:**
```typescript
const {
  openFolder,
  setSelectedModel,
  setSelectedProvider,
  ensureIndexProgressSubscription,
  ensureAgentMetricsSubscription,
  agentMetrics,
  ensureProviderModelConsistency,
} = useAppStore()
```

**After:**
```typescript
// State - use selectors
const agentMetrics = useAppStore(selectAgentMetrics)
const currentView = useAppStore(selectCurrentView)

// Actions only
const openFolder = useAppStore((s) => s.openFolder)
const setSelectedModel = useAppStore((s) => s.setSelectedModel)
// ... etc
```

## Performance Impact

- **Before**: Every keystroke in chat input caused 6+ components to re-render
- **After**: Only components that actually use `chatInput` re-render (just ChatPane)

This dramatically reduces unnecessary re-renders and improves typing responsiveness.

## Best Practices Going Forward

1. **Always use selectors for state** - Never destructure state from `useAppStore()`
2. **Actions can be accessed directly** - They don't cause re-renders
3. **Create selectors for commonly used state** - Add them to `src/store/index.ts`
4. **Use inline selectors sparingly** - Prefer exported selectors for consistency

## Related Documentation

- [Store Migration Guide](./store-migration-guide.md)
- [Zustand Best Practices](https://docs.pmnd.rs/zustand/guides/performance)

