# Debugging Stop Flow Button - Running Flow Issue

## Problem
The Stop Flow button works when no flow is running, but when a flow IS running, clicking Stop doesn't reset the UI. The flow appears to stop on the backend, but the frontend UI stays in 'running' state with the spinner.

## Hypothesis
The 'done' event might not be reaching the frontend, or it's being dropped somewhere in the event handling chain.

## Debugging Changes Added

### Backend Logging (electron/flow-engine/index.ts)
Added logging to `cancelFlow` function to verify the 'done' event is being emitted:
```
[cancelFlow] Emitted done event for requestId: ... sessionId: ... workspaceId: ...
[cancelFlow] Error emitting done event: ...
```

### WebSocket Server Logging (electron/backend/ws/server.ts)
Added detailed logging to `broadcastFlowEvent` function:
```
[broadcastFlowEvent] Event type: ... sessionId: ... workspaceId: ... requestId: ...
[broadcastFlowEvent] Using workspaceId from event as fallback: ...
[broadcastFlowEvent] Resolved workspace: ...
[broadcastFlowEvent] Broadcasting event to workspace: ...
[broadcastFlowEvent] Failed to find workspace for sessionId: ... workspaceId: ... event type: ...
```

### Frontend Event Subscription Logging (src/store/flowRuntime.ts)
Added logging to `initFlowRuntimeEvents`:
```
[flowRuntime] Received event: ... requestId: ...
[flowRuntime] Error handling event: ...
```

### Frontend Event Handler Logging (src/store/flowRuntime.ts)
Added logging to `handleEvent` to trace event filtering:
```
[handleEvent] Dropping event due to session mismatch: ...
[handleEvent] RequestId mismatch: ... isTerminal: ... isStartish: ...
[handleEvent] Dropping terminal event due to requestId mismatch
[handleEvent] Processing done event, resetting UI
```

## How to Debug
1. Start a flow in the UI
2. Click the Stop button
3. Check the browser console (DevTools) for `[flowRuntime]` logs
4. Check the backend console for `[cancelFlow]` and `[broadcastFlowEvent]` logs
5. Trace the event path to see where it's being dropped

## Expected Log Sequence
1. Backend: `[cancelFlow] Emitted done event for requestId: ...`
2. Backend: `[broadcastFlowEvent] Event type: done ...`
3. Backend: `[broadcastFlowEvent] Broadcasting event to workspace: ...`
4. Frontend: `[flowRuntime] Received event: done ...`
5. Frontend: `[handleEvent] Processing done event, resetting UI`

If any step is missing, that's where the issue is.

