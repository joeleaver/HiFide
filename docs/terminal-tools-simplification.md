# Terminal Tools Simplification

## Overview

Simplified the terminal tools from 7 tools down to 5 by removing redundancy and merging related functionality.

## What Changed

### Before (7 tools)
1. `terminal.run` - One-shot command execution (output NOT visible in UI)
2. `terminal.session_present` - Create/get persistent session (returns metadata)
3. `terminal.session_exec` - Execute command in session (output visible in UI)
4. `terminal.session_search_output` - Search session output
5. `terminal.session_tail` - Get recent output
6. `terminal.session_restart` - Restart session
7. `terminal.session_close` - Close session

**Problems:**
- Agent had to call TWO tools just to run a command (`session_present` + `session_exec`)
- `terminal.run` was invisible to the user (no UI feedback)
- Confusing which tool to use when

### After (4 tools)
1. **`terminal.exec`** - Execute command in persistent session (merged `session_present` + `session_exec`)
2. `terminal.session_search_output` - Search session output
3. `terminal.session_tail` - Get recent output
4. `terminal.session_restart` - Restart session

**Benefits:**
- **Single tool to run commands** - Agent just calls `terminal.exec`
- **Auto-creates session** - No need to call separate "present" tool
- **Always visible** - All commands show in the agent's terminal panel UI
- **Returns session info** - Get metadata (cwd, shell, last commands) with every execution
- **Auto-cleanup** - Sessions are automatically cleaned up when agent request completes (no manual close needed)

## Key Insight

The agent has a **visible terminal panel** at the bottom of the UI that displays the persistent PTY session. This means:

- Commands should ALWAYS use the persistent session (visible to user)
- One-shot invisible commands (`terminal.run`) are confusing and hide what's happening
- The session is automatically created on first use - no need for separate "present" tool

## The New `terminal.exec` Tool

### Description
Execute a command in the persistent terminal session (visible in UI). Auto-creates session if needed. Output streams to the visible terminal panel. Risk gating applies to destructive operations.

### Parameters
```typescript
{
  command: string          // Required: Shell command to execute
  cwd?: string            // Optional: Working directory (only used when creating new session)
  autoApproveEnabled?: boolean
  autoApproveThreshold?: number
  confidence?: number
}
```

### Returns
```typescript
{
  ok: true,
  sessionId: string,
  shell: string,
  cwd: string,
  commandCount: number,
  lastCommands: Array<{
    id: number,
    command: string,
    startedAt: number,
    endedAt?: number,
    bytes: number,
    tail: string
  }>,
  liveTail: string  // Last 400 chars of terminal output
}
```

### Example Usage

**Before (2 tool calls):**
```typescript
// 1. Create/get session
await agent.call('terminal.session_present', {})

// 2. Execute command
await agent.call('terminal.session_exec', { 
  command: 'npm test' 
})
```

**After (1 tool call):**
```typescript
// Single call - auto-creates session and executes
await agent.call('terminal.exec', { 
  command: 'npm test' 
})
```

## Implementation Details

### How It Works

1. **Auto-creates session**: Calls `__getOrCreateAgentPtyFor(requestId)` which:
   - Returns existing session if one exists for this request
   - Creates new session if needed
   - Binds session to the request ID

2. **Attaches to UI**: Ensures the terminal output streams to the visible terminal panel

3. **Risk gating**: Checks for risky commands (installs, deletes) and blocks unless auto-approved

4. **Executes command**: Writes command + newline to the PTY

5. **Returns metadata**: Includes session info, command history, and recent output

### Session Lifecycle

- **Creation**: First call to `terminal.exec` creates the session
- **Persistence**: Session persists across multiple tool calls
- **Binding**: One session per agent request ID
- **Visibility**: Output always streams to the agent's terminal panel UI
- **Cleanup**: Session is cleaned up when agent request completes

## Files Changed

### Removed
- `electron/tools/terminal/run.ts` - One-shot invisible execution (removed)
- `electron/tools/terminal/sessionPresent.ts` - Separate session creation (merged into exec)
- `electron/tools/terminal/sessionClose.ts` - Manual session cleanup (unnecessary - auto-cleanup on request completion)

### Modified
- `electron/tools/terminal/sessionExec.ts` → `electron/tools/terminal/exec.ts`
  - Renamed tool from `terminal.session_exec` to `terminal.exec`
  - Added optional `cwd` parameter
  - Now returns full session metadata (merged from `session_present`)
  - Auto-creates session if needed (was already doing this)

### Updated
- `electron/tools/index.ts` - Updated imports and exports
- `docs/agent-tools-refactoring.md` - Updated tool counts and descriptions

## Remaining Terminal Tools

### `terminal.session_search_output`
Search through terminal output history.

**Use case**: Find error messages, check if a specific output appeared

### `terminal.session_tail`
Get the last N bytes of terminal output.

**Use case**: Quick check of recent output without full history

### `terminal.session_restart`
Kill and recreate the terminal session.

**Use case**: Clean slate when environment is corrupted



## Migration Guide

If you have any code or prompts that reference the old tools:

### Replace `terminal.run`
```diff
- terminal.run({ command: 'npm test' })
+ terminal.exec({ command: 'npm test' })
```

### Replace `terminal.session_present` + `terminal.session_exec`
```diff
- await terminal.session_present({})
- await terminal.session_exec({ command: 'npm test' })
+ await terminal.exec({ command: 'npm test' })
```

### Keep using other session tools as-is
```typescript
// These remain unchanged
terminal.session_search_output({ query: 'error' })
terminal.session_tail({ maxBytes: 2000 })
terminal.session_restart({})
```

## Benefits Summary

1. ✅ **Simpler API** - One tool instead of two for basic command execution
2. ✅ **Better UX** - All commands visible in UI terminal panel
3. ✅ **Less confusion** - Clear which tool to use (just use `exec`)
4. ✅ **Same power** - All functionality preserved, just better organized
5. ✅ **Auto-magic** - Session creation is automatic, no manual management needed

## Total Tool Count

- **Before**: 24 tools (7 terminal tools)
- **After**: 21 tools (4 terminal tools)
- **Reduction**: 3 tools removed, API simplified

