---
id: 5660eca9-99a4-4c52-8bf0-3fb8ac0cd095
title: Flow runtime controls and metadata sync
tags: [flow-runtime, ui, session-controls]
files: [src/components/SessionControlsBar.tsx, src/store/sessionUi.ts, src/services/flow.ts]
createdAt: 2025-12-03T23:38:39.901Z
updatedAt: 2025-12-04T00:02:03.181Z
---

### Overview
The flow status widget inside `src/components/SessionControlsBar.tsx` exposes the **Start** and **Stop** buttons that call `FlowService.start` / `FlowService.cancel` based on the renderer-side runtime store (`useFlowRuntime`). The widget also hosts the flow dropdown and provider/model selectors that ultimately call into `useSessionUi` (`src/store/sessionUi.ts`) so the backend knows which template and model to execute.

### Key Detail
`session.setExecutedFlow` and `session.setProviderModel` RPCs are async and can still be in-flight when a user immediately clicks **Start** or **Stop**. Because the `flow.start` RPC on the backend reads the current session metadata, starting while one of those RPCs is still running causes the wrong flow/model to execute or stop requests that belong to a previous context. This manifests as “start/stop doesn’t do the right thing” even though the commands technically succeed.

### Design Fix
Track any pending metadata mutations kicked off by the dropdowns (flow selection or provider/model changes) inside the status widget. Before issuing `FlowService.start`/`cancel`, await all pending metadata promises so the backend session state is up-to-date. While promises are pending, disable the Start button (and show a busy cursor/tooltip) and debounce repeat clicks by also tracking in-flight start/stop actions. This keeps the renderer in sync with backend state and prevents duplicate start attempts or cancelling the wrong run.

### Implementation Hooks
- Wrap metadata-changing handlers in helpers that register their returned promises in a `pendingMetaPromises` ref and toggle a `metaPending` state flag for UI disabling.
- Provide a `waitForPendingMeta()` helper that copies `pendingMetaPromises.current` and `await Promise.allSettled(...)` before allowing start/stop.
- Gate the ActionIcons in `SessionControlsBar` (`Flow status widget`) with `disabled={metaPending || actionInFlight !== null}` and guard against duplicate clicks by tracking `actionInFlight`.

### Session metadata defaults & refresh
- `SessionService.newSessionFor` now inherits the currently selected session’s provider, model, and last executed flow (if present). Starting a new session therefore clones the dropdown selections from the previous session instead of falling back to `openai / gpt-4o` and the `default` flow.
- After both `session.select` and `session.new`, plus whenever a `session.selected` broadcast arrives, the renderer calls `session.getCurrentMeta` and pushes `{ executedFlowId, lastUsedFlowId, providerId, modelId }` into `sessionUi.__setMeta`. This keeps the SessionControlsBar dropdowns aligned with backend truth without waiting for a new workspace snapshot.
- The metadata fetch completes before `refreshFlowRuntimeStatusWithRetry`, guaranteeing we scope the flow runtime to the right session and show the correct provider/model badges while a new session hydrates.
