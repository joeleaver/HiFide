---
id: c10fb9d6-1e35-475a-aecc-e7c15a3b5284
title: PTY Attachment in Workspace Loading
tags: [terminal, pty, workspace-loading, bug-fix, race-condition]
files: [electron/services/index.ts, electron/services/TerminalService.ts, electron/backend/ws/workspace-loader.ts]
createdAt: 2025-12-01T22:31:02.360Z
updatedAt: 2025-12-01T22:31:02.360Z
---

## Issue
PTY (pseudo-terminal) was not getting attached to agent terminals during workspace loading, causing the terminal to be non-functional.

## Root Cause
There was a race condition in the service initialization and workspace loading sequence:

1. **Service initialization order**: `TerminalService` was created in Phase 3, but `SessionService` was created in Phase 4
2. **TerminalService** used a `setTimeout(..., 100)` hack to wait for `SessionService` to be available before registering event listeners
3. **Workspace loading** would load and select sessions, firing `session:selected` events
4. **Race condition**: If workspace loading completed before the 100ms timeout, the event listeners would not be registered yet, and the PTY would never be created

## Solution
Two-part fix implemented:

### 1. Fixed Service Initialization Order
Moved `SessionService` to Phase 3 (before `TerminalService` in Phase 4) in `electron/services/index.ts`:
- `SessionService` and `FlowCacheService` now initialize in Phase 3
- `TerminalService` and `AppService` now initialize in Phase 4
- This guarantees `SessionService` exists when `TerminalService` constructor runs

### 2. Removed setTimeout Hack
In `electron/services/TerminalService.ts`:
- Removed the `setTimeout(..., 100)` delay
- Made event listener registration synchronous in constructor
- Now listeners are registered immediately and won't miss events

### 3. Added Safeguard in Workspace Loader
In `electron/backend/ws/workspace-loader.ts`:
- Added explicit PTY attachment after session selection (step 7.5)
- Serves as a safeguard to ensure PTY is created even if event was missed
- Non-blocking - workspace load continues even if PTY attachment fails

## Testing
After this fix:
- PTY should attach immediately when a session is created or selected
- Agent terminal should be functional on workspace load
- No more race conditions between service initialization and workspace loading
