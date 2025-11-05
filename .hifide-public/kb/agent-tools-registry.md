---
id: 81f504fb-d2cd-4e91-9003-7aba92ffeeb3
title: Agent tools registry
tags: [agent, tools, architecture]
files: [electron/tools/index.ts, electron/main.ts, electron/tools/agent/assessTask.ts, electron/tools/agent/checkResources.ts, electron/tools/agent/summarizeProgress.ts]
createdAt: 2025-11-03T21:29:28.799Z
updatedAt: 2025-11-03T21:29:28.799Z
---

## Registry composition
- `electron/tools/index.ts` aggregates all agent-callable tools into `agentTools`, grouped by concern (self-regulation, filesystem, edits, workspace discovery, text search, indexing, terminal, code refactors, knowledge base).
- Self-regulation tools (`agent/assessTask`, `agent/checkResources`, `agent/summarizeProgress`) enforce budgeting using the policy documented in `AGENT_SELF_REGULATION.md`.
- Filesystem and edits tools wrap `fs`, `move/copy/remove`, `applyEdits`, and `applyPatch` operations with policy-aware prompts.
- Workspace discovery tools (`workspace/searchWorkspace`, `workspace/jump`, `workspace/map`) are the preferred code navigation primitives.
- Terminal wrappers (`terminal/exec`, `sessionSearchOutput`, `sessionTail`, `sessionRestart`) coordinate with PTY handlers under `electron/ipc/pty.ts`.
- Code-focused helpers (`code/searchAst`, `code/applyEditsTargeted`, `code/replaceCall`, `code/replaceConsoleLevel`) leverage AST transforms for safe edits.
- Knowledge base tooling exposes `knowledgeBaseSearch` and `knowledgeBaseStore` for in-app documentation management.

## Exposure
- `electron/main.ts` assigns the registry to `globalThis.__agentTools` so the orchestrator can import them dynamically during agent execution.
