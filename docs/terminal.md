# Embedded Terminal Design

## Why embedded
- Single, consistent environment across OSes
- Easy to stream output, set env vars, and capture exit codes
- Enforce allow/deny policies and timeouts in-process

## Components
- Backend: `node-pty` in Electron main; one PTY per session (ID)
- Frontend: `xterm.js` in renderer for display and input
- IPC: create/resize/write/dispose events, and data stream back to renderer

## Session lifecycle
- create → returns sessionId and initial cwd/env
- write(data) → send user/agent input
- resize(cols, rows)
- close() → cleanup

## Policy gates
- Start in safe mode (tests/linters/type-check/build only)
- Require confirmation for risky commands (installs, migrations, deploys, destructive fs)
- Auto-approve toggle: if enabled and confidence >= threshold, proceed without prompt, but log

## Redaction & logging
- Redact secrets in output (API keys, tokens) via regex/patterns
- Structured logs with timestamps and exit codes; attach to verification reports

## Environment & cwd
- Configure per-session env (PATH, NODE_OPTIONS, proxies)
- Set working directory to selected workspace root; optional subdir per command

## Integration with tools
- `run_command` tool uses PTY when interactive behavior helps; falls back to spawn for non-TTY tasks
- `run_tests` selects smallest scope; streams output to terminal pane and captures summary

## UI
- Terminal tab with session picker
- Command palette to run common verifications
- Toggle for safe mode and auto-approve



## IPC API (MVP implemented)

Renderer → Main (invoke):
- `pty:create(opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string,string> }) => { sessionId }`
- `pty:write({ sessionId, data }) => { ok }`
- `pty:resize({ sessionId, cols, rows }) => { ok }`
- `pty:dispose({ sessionId }) => { ok }`

Main → Renderer (send):
- `pty:data` payload: `{ sessionId, data }`
- `pty:exit` payload: `{ sessionId, exitCode }`

Preload bridge exposes `window.pty` with `create/write/resize/dispose/onData/onExit`.
