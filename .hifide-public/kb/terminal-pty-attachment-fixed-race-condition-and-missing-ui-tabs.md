---
id: 11bd9389-74a5-4f68-98f3-9365b4142a2f
title: Terminal PTY Attachment - Fixed Race Condition and Missing UI Tabs
tags: [terminal, pty, bug-fix, ui, agent]
files: [electron/services/TerminalService.ts, src/components/TerminalPanel.tsx, src/store/terminalTabs.ts]
createdAt: 2025-12-01T22:39:59.206Z
updatedAt: 2025-12-01T22:39:59.206Z
---

## Overview
The PTY (pseudo-terminal) was not being displayed in the agent terminal panel during workspace loading. Two issues were identified and fixed:

1. **Race condition in service initialization** (Phase 1 fix)
2. **Missing UI terminal tabs** (Phase 2 fix - this document)

## Problem: PTY Created But Not Displayed

### Symptoms
- Logs showed: `[Terminal] PTY ensured for session: <id>`
- Logs showed: `[broadcast] Sent terminal.data to 1/1 connections`
- Frontend displayed: "no terminals open"

### Root Cause
The `TerminalService` has two separate concerns:
1. **PTY Sessions**: Backend pseudo-terminals (managed by `agentPty`)
2. **Terminal Tabs**: Frontend UI elements (managed by `agentTerminalTabs` state)

When a session was selected/created:
- ✅ PTY was created successfully
- ❌ No terminal tab was created in `agentTerminalTabs[]`
- Result: Frontend had nothing to display

## Fix Applied

Added terminal tab creation to session event listeners in `TerminalService.ts`:

```typescript
// In session:created listener
if (this.state.agentTerminalTabs.length === 0) {
  const tabId = this.addTerminalTab('agent')
  console.log('[Terminal] Created agent terminal tab:', tabId)
}

// In session:selected listener  
if (this.state.agentTerminalTabs.length === 0) {
  const tabId = this.addTerminalTab('agent')
  console.log('[Terminal] Created agent terminal tab:', tabId)
}
```

## Architecture Notes

### Terminal Tab vs PTY Session
- **Terminal Tab** (`agentTerminalTabs`): UI element with ID like `a1234567`
  - Controls what the frontend renders
  - State emitted via `terminal:tabs:changed` event
  - Retrieved via `terminal.getTabs` RPC

- **PTY Session**: Backend shell process with ID like `7fac3845-12ab-4fac-9608-8d90bb9f4cd8`
  - Managed by `agentPty.ts`
  - Bound to agent session ID
  - Sends terminal data via WebSocket

### Data Flow
1. Session selected → `session:selected` event
2. TerminalService creates PTY for session
3. TerminalService creates terminal tab (if none exist)
4. `terminal:tabs:changed` event fired
5. Frontend receives tabs via WebSocket
6. Frontend renders TerminalPanel with tabs
7. TerminalView mounts and subscribes to PTY data

## Related Fixes
- Service initialization order (SessionService before TerminalService)
- Removed setTimeout hack from TerminalService constructor
- Added safeguard in workspace-loader.ts for explicit PTY attachment