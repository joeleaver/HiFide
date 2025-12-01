# Loading Architecture Debug Checklist

## Problem
After refactoring to push-based loading, "almost nothing works" except model chooser and session chooser.

## Debug Steps

### 1. Check Console Logs

Open DevTools console and look for these log messages in order:

**Backend (Main Process):**
```
[snapshot] Built workspace snapshot: { workspaceId, sessionCount, currentSessionId, meta, flowsCount, ... }
```
- Verify `meta.executedFlowId`, `meta.providerId`, `meta.modelId` are populated
- Verify `flowsCount` > 0
- Verify `currentSessionId` is set

**Renderer (Frontend):**
```
[hydration] Received workspace snapshot: { workspaceId, sessions, currentSessionId, meta, flows }
```
- Verify this event is received
- Verify data matches what backend sent

```
[hydration] Hydrating sessionUi with: { sessions, currentSessionId, meta, flows, ... }
```
- Verify all fields are populated

```
[hydration] sessionUi hydrated, current state: { flows, executedFlowId, providerId, modelId }
```
- Verify flows.length > 0
- Verify executedFlowId, providerId, modelId are set

### 2. Check Event Flow

The correct sequence should be:
1. `[bootstrap] All listeners ready, signaling window.ready to main process`
2. `[workspace-loader] Reloaded flow profiles for workspace`
3. `[snapshot] Built workspace snapshot`
4. `[hydration] Received workspace snapshot`
5. `[hydration] Hydrating sessionUi`
6. `[hydration] sessionUi hydrated`
7. `[hydration] loading.complete received, transitioning to ready`

### 3. Check Store State

After loading completes, check the sessionUi store state in DevTools:

```javascript
// In console:
window.__sessionUiStore = require('./store/sessionUi').useSessionUi
window.__sessionUiStore.getState()
```

Expected state:
- `flows`: Array with length > 0
- `executedFlowId`: String (flow ID)
- `providerId`: String (e.g., 'openai')
- `modelId`: String (e.g., 'gpt-4o')
- `currentId`: String (session ID)
- `sessions`: Array with length > 0

### 4. Common Issues

**Issue: Snapshot not being sent**
- Check if `sendWorkspaceSnapshot` returns true
- Check if `buildWorkspaceSnapshot` returns non-null

**Issue: Snapshot received but stores not hydrated**
- Check for errors in `hydrateStoresFromSnapshot`
- Check if `__setMeta`, `__setFlows`, etc. are being called

**Issue: Stores hydrated but UI not updating**
- Check if components are subscribed to the right store fields
- Check if store selectors are correct

**Issue: Data is empty in snapshot**
- Check if services are returning data (FlowProfileService, ProviderService, etc.)
- Check if workspace is properly opened before snapshot is built

### 5. What Should Work

After successful loading:
- **Session chooser**: Should show list of sessions ✓ (user says this works)
- **Model chooser**: Should show provider/model options ✓ (user says this works)
- **Flow chooser**: Should show list of flows (grouped by library)
- **Timeline**: Should show session history
- **Start/Stop buttons**: Should be enabled
- **Kanban screen**: Should show board
- **Knowledge Base screen**: Should show entries
- **Flow Editor screen**: Should show graph

### 6. Next Steps

If logs show data is being sent but not received:
- Check if event subscriptions are set up before snapshot is sent
- Check if there's a timing issue

If logs show data is received but not applied:
- Check if `__setMeta` is spreading correctly
- Check if there are TypeScript errors preventing state updates

If logs show data is applied but UI not updating:
- Check if components are re-rendering
- Check if selectors are memoized incorrectly

