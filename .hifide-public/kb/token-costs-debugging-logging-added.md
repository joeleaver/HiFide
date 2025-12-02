---
id: d788f7e9-e84e-47d4-a149-e459ae148151
title: Token Costs Debugging - Logging Added
tags: [debugging, tokens, costs, ui, state-management]
files: [src/store/sessionUi.ts, src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-01T23:51:16.761Z
updatedAt: 2025-12-01T23:51:16.761Z
---

## Token Costs Debugging Summary

### Problem
The UI isn't responding to `session.usage.changed` events from main. Events are being sent but the Tokens & Costs panel isn't updating.

### Logs Added

1. **Event Reception** (`src/store/sessionUi.ts` line ~248-256)
   - Logs when `session.usage.changed` events are received
   - Shows payload structure and data presence

2. **State Update** (`src/store/sessionUi.ts` line ~134-137)
   - Logs before calling `set()` with the new data
   - Logs after `set()` to show current state

3. **Store Subscription** (`src/store/sessionUi.ts` line ~179-185)
   - Global Zustand store subscription
   - Logs on ANY state change to verify reactivity

4. **Component Rendering** (`src/components/TokensCostsPanel.tsx` line ~24)
   - Logs when the component renders
   - Shows what `tokenUsage` data it receives

### Expected Log Flow
When a token usage event occurs, you should see:
1. `[sessionUi] Received session.usage.changed event:` - Event received
2. `[sessionUi.__setUsage] Updating state with:` - About to update state
3. `[sessionUi.__setUsage] State updated. Current state:` - State updated
4. `[sessionUi.subscribe] Store state changed:` - Store notified subscribers
5. `[TokensCostsPanel] Rendering with tokenUsage:` - Component re-rendered

### Next Steps
Run an LLM request and check console logs to identify which step is failing.
