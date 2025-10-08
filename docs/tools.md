# Tools and IPC APIs

This document describes the APIs exposed to the renderer/agent and the planned tool surface.

## Implemented IPC APIs

### `window.secrets`
- `setApiKey(key: string): Promise<boolean>` — stores OpenAI key in OS keychain
- `getApiKey(): Promise<string | null>`

### `window.llm`
- `start(requestId: string, messages: {role, content}[], model?: string, provider?: string)` — starts streaming; emits `llm:chunk`, `llm:done`, `llm:error`
- `cancel(requestId: string)` — cancels an in-flight stream

### `window.fs`
- `getCwd(): Promise<string>`
- `readFile(path: string)` → `{ success: boolean, content?: string, error?: string }`
- `readDir(path: string)` → `{ success: boolean, entries?: {name,isDirectory,path}[], error?: string }`

## Planned tool surface (for the agent)

### Codebase access
- `search_project(query: string, globs?: string[], max_results?: number)`
- `view_file(path: string, range?: [startLine, endLine])`

### Writes (guarded)
- `apply_patch(diffs: {path: string, hunk: string}[], preview?: boolean)`
  - Pre-checks: format, lint, type-check
  - User approval: required for multi-file or large edits

### Execution/verification
- `run_command(cmd: string, cwd?: string, timeout?: number, safe?: boolean)`
  - Safe-by-default allow-list (tests/linters/build)
  - Confirmation required for installs, migrations, deploys, destructive fs
- `run_tests(target: string, scope: 'impacted'|'file'|'suite')`

## Permission policy
- Allowed without prompt: tests, linters, type-checkers, builds (non-destructive).
- Requires user confirmation: package installs, DB migrations, deploys, deletes or mass writes.
- Always show diffs before writes; summarize command, cwd, exit code, and key log lines after executions.

