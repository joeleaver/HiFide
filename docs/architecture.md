# Architecture

This app is an Electron desktop application with a React renderer. It is being evolved from a chat UI into a full agentic coding tool.

## Current components
- Renderer (React + Vite): Chat UI, conversation store, settings UI.
- Main process (Electron): IPC orchestration, OpenAI streaming provider, secure key storage via keytar.
- Preload: Safe bridge exposing curated APIs (`ipcRenderer`, `secrets`, `llm`, `fs`).


## State management (simplified)
- Single source of truth: a single Zustand store in `src/store/app.ts` contains both UI and chat/session state.
- Deprecated facades: `useChatStore` was removed; use `useAppStore` everywhere.
- Reads via selectors, writes via store actions. Components must not duplicate business state in local React state.
- Persistence: we use `zustand/middleware` persist; some legacy keys are mirrored in `localStorage` for migration/back-compat.
- Side effects: IPC calls (e.g., PTY, view switching, model refresh) are triggered inside store actions to keep component code declarative.
- Dev tooling: the store remains available on `window.__appStore` for automation/e2e.

## Current capabilities (implemented)
- Streaming chat completions via OpenAI (function-call style IPC) with cancel support.
- Secure API key storage using OS keychain via `keytar`.
- Minimal filesystem read helpers (cwd, readFile, readDir).

## Planned capabilities (agentic coding)
- Context engine: repo indexing (symbol/AST summaries), embeddings + vector store, import graph, on-demand retrieval.
- Tooling surface:
  - search_project, view_file(path, range)
  - apply_patch(diffs) with preview and pre-commit checks (format/lint/typecheck)
  - run_command(command, cwd, timeout) with policy gates
  - run_tests(target, scope=impacted|file|suite)
- Verification loop: after edits, run focused tests/linters/build and iterate on failures.
- Permission model: safe-by-default (tests/linters/build ok); prompt for risky actions (installs, migrations, deploys, destructive fs).

## Security boundaries
- `contextIsolation: true`, `nodeIntegration: false`, limited, explicit preload APIs.
- Secrets never exposed to the renderer as plain env; retrieved via IPC on demand.
- Future tools will enforce allow-lists, timeouts, and dry-run where available.

## High-level data flow
1. User prompt → Renderer sends `llm:start` with messages/model/provider.
2. Main process streams chunks via provider adapter → renderer updates UI.
3. Future: Agent plans tool calls → uses IPC tools for search/view/edit/verify → summarizes outcome → requests approval when crossing permission boundaries.

