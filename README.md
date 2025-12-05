# Hifide — Agentic Coding Desktop App (Electron + React)

Hifide turns a familiar chat UI into a local, tool-using coding assistant. It runs as an Electron desktop app with a React renderer, integrates tightly with your filesystem, and (optionally) uses an embedded terminal, AST-aware structured edits, and repository indexing to help you build and refactor faster.

Status: core chat + streaming via OpenAI is stable. Terminal, structured edits, and indexing are in active development or behind feature flags. See docs for details.


## Key Features
- Chat-first developer experience with streaming responses and cancel support
- Provider-agnostic orchestration with adapters for OpenAI, Anthropic, and Google Gemini
- Local tool integrations (policy-gated)
  - Filesystem read/write with explicit diff previews and user approval
  - Embedded terminal sessions (PTY) with allow/deny policies [experimental]
  - Structured code edits powered by TypeScript/ts-morph [experimental]
- Optional local project indexing + retrieval for large repos [experimental]
- Secure API key storage in the OS keychain via keytar
- Cross-platform: Windows, macOS, and Linux


## Architecture (brief)
- Renderer (React + Vite): chat UI, editor panes, notifications, settings
- Main (Electron): provider streaming, IPC orchestration, secure key storage, tool execution
- Preload bridge: curated APIs exposing fs, terminal, and other OS-bound features to the renderer
- Orchestrator: provider-agnostic agent loop with tool-calling policies and planning

More details: docs/architecture.md and docs/retrieval.md.


## Requirements
- Node.js 20+
- pnpm 9+ (via Corepack)
- macOS, Windows, or Linux
- Provider API keys as needed (OpenAI, Anthropic, Google Gemini)

Enable pnpm with Corepack if needed
- corepack enable
- corepack prepare pnpm@latest --activate


## Installation
1) Clone the repository
- git clone <your-fork-or-ssh-url>
- cd hifide

2) Install dependencies
- pnpm install

## Quick Start
- pnpm dev
- In Settings → Providers, add your API key(s)
- File → Open Folder… to select a workspace
- (Optional) Settings → Agent & Tools: enable Filesystem write, Terminal, Structured edits
- (Optional) Settings → Indexing: enable local indexing for large repos
- Start a chat. Ask the agent to inspect files or propose changes, then review and apply diffs


## Development
- Start the app in development mode
  - pnpm dev
  - Launches the Vite dev server and Electron (via vite-plugin-electron). The renderer hot-reloads on changes.

- Lint the project
  - pnpm lint

- Preview the built renderer (web-only)
  - pnpm preview

Tip: The first launch may prompt for OS permissions (keychain access, terminal). Use View → Toggle Developer Tools to inspect logs.


## Build & Package
- Create a production build and platform package
  - pnpm build
  - Outputs: dist/ (renderer), dist-electron/ (main/preload). electron-builder produces installers under release/.


## Provider Configuration
Configure providers in Settings (recommended) or via environment variables when launching from a terminal. Saved keys are stored securely in the OS keychain (keytar).

- OpenAI
  - Env: OPENAI_API_KEY
  - Models: gpt-4o, gpt-4.1, o3-mini, etc.
  - Notes: streaming and tool/function calling are supported

- Anthropic
  - Env: ANTHROPIC_API_KEY
  - Models: Claude 3.x family
  - Notes: tool usage via orchestration adapter

- Google Gemini
  - Env: GOOGLE_API_KEY
  - Models: Gemini 1.5/2.x
  - Notes: tool calls mapped via adapter layer

If both env vars and saved secrets exist, the saved secret usually takes precedence.


## Agent Mode: Tool-Calling and Structured Edits
Agent Mode lets the assistant call local tools during a conversation. You control which tools are enabled and the confirmation level.

- Filesystem tools
  - Read: fetch file contents and directory listings for context
  - Write: propose precise edits and show a unified diff for approval before applying
  - Scope: restricted to the selected workspace; binary files are ignored

- Terminal tool [experimental]
  - PTY-backed shell (node-pty + xterm) inside the app
  - Uses: run tests/linters/builds, quick scripts
  - Policy: disabled by default; opt-in per workspace; confirmations for risky commands
  - Behavior: terminalExec(command) is the only input. It blocks for up to 60s (or until the command exits) and then returns the entire log capped at 500 lines.
  - Long runs: If the command produces more than 500 lines or is still running after 60s, the tool responds with "Command is long running and still in progress, use terminalSessionCommandOutput to see current state" and includes the commandId.
  - Continuations: Call terminalSessionCommandOutput with that commandId (and optional offset/maxBytes) to page through the remaining log deterministically.
>>>>>> REPLACE

- Structured edits [experimental]
  - AST-aware refactors using TypeScript and ts-morph
  - Safer large changes: symbol renames, import updates, function/class insertions with type-correct signatures
  - UI: preview and accept/reject per-file diffs

Enable/disable under Settings → Agent & Tools.


## Local Indexing and Retrieval [experimental]
Scale to large repos by indexing locally and retrieving just-in-time context.
- Indexer: parses files, extracts symbols, embeds chunks, and builds a dependency graph
- Storage: local vector store with metadata
- Usage: enable in Settings, choose folders, let indexing complete, then ask questions; the agent retrieves relevant snippets automatically
- Privacy: indexes stay local to your machine

See docs/retrieval.md for design and roadmap.


## Terminal Risk Policy
Running shell commands from an agent is risky. Hifide applies layered safeguards:
- Default: terminal tool disabled
- Explicit opt-in per workspace
- Guardrails: allow/deny lists, timeouts, and exit code checks
- Confirmation gates for destructive or network-affecting operations (e.g., rm -rf, git push, publish)
- Audit trail: per-session command history

See docs/architecture.md for design and policy gates.


## TypeScript Refactors with ts-morph [experimental]
When Structured Edits are enabled, the agent can:
- Rename symbols across files and update imports
- Insert/move functions and classes with correct types
- Update interfaces and types and propagate changes
- Generate codemods with previewable diffs

Edits are proposed first; you approve individual files or the entire change set. See docs/implementation-plan.md for validation loops (lint/tests/build before/after).


## Keyboard Shortcuts
- Cmd/Ctrl+Enter — send message
- Esc — cancel streaming response
- Cmd/Ctrl+K — focus chat input
- Cmd/Ctrl+/ — toggle command palette (if enabled)
- Cmd/Ctrl+S — apply approved edits (when diff view is focused)

Shortcuts may vary by OS and feature flags.


## Troubleshooting
- Keytar install/build errors
  - Ensure native build tools are present (Windows: Desktop development with C++; macOS: Xcode Command Line Tools)
  - Clear and reinstall: rm -rf node_modules && pnpm install

- node-pty or other native deps fail to build
  - Ensure Python 3 and a C/C++ toolchain are available
  - On Windows, set the VS version if needed: npm config set msvs_version 2022

- Blank window or renderer crash
  - Open DevTools (Cmd/Ctrl+Alt+I) and check terminal logs
  - Try disabling GPU: ELECTRON_ENABLE_LOGGING=1 ELECTRON_DISABLE_GPU=1 pnpm dev

- Provider 401/permission errors
  - Verify API keys in Settings; confirm env vars if launching from a terminal
  - On corporate networks, set HTTP_PROXY/HTTPS_PROXY if required

- electron-builder packaging issues
  - Delete dist/, dist-electron/, and release/, then re-run pnpm build


## Contributing
Contributions are welcome! Please:
- Read docs/architecture.md and docs/implementation-plan.md
- Open an issue to discuss substantial changes first
- Use TypeScript and keep PRs focused with clear commits
- Update documentation for new features

PR checklist
- pnpm lint
- pnpm build
- Manual run-through of new UI/flows


## License
See the LICENSE file in the repository root. If no license file is present, the project is currently unlicensed; please contact the maintainers to clarify usage terms.
