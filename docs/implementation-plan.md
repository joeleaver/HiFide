# Implementation Plan

This plan will evolve as we capture decisions and progress. It maps 1:1 to our architecture and roadmap docs.

## Known Baseline (from repo)
- Runtime: Electron desktop app (React renderer + Node main)
- Language/stack: TypeScript, Vite, Electron, Mantine UI, Zustand
- Provider: OpenAI via `openai` SDK with streaming support
- Secrets: OS keychain via `keytar`
- Current capabilities: chat UI, streaming, cancel; minimal FS read; no terminal, no structured edits, no retrieval/indexing

## Open Decisions (to be filled via Q&A)
- [ ] Repo scale (files/size)
- [ ] OS targets to prioritize (Windows/macOS/Linux)
- [ ] Immediate priorities (read-only, terminal/verification, writes)
- [ ] Embedding model and vector store choice
- [ ] Permission defaults (strict read-only vs. allow verification)

## Immediate Plan — Reordered (Phase 4 first)

### Phase A — Agentic Core (Writes + Verification + AST-aware TS)
- Deliverables
  - [ ] apply_patch tool (unified diff hunks) with preview + atomic multi-file
  - [ ] Pre-checks: format, lint, type-check gates (TS: tsc/tsserver; format: prettier)
  - [ ] run_command with allow-list, timeouts, redaction; run_tests with scopes
  - [ ] Initial AST-aware edits for TypeScript (tsserver/ts-morph) for safe refactors
  - [ ] Diff viewer in UI and user approval flow (with auto-approve toggle)
- Implementation Notes
  - IPC tools from renderer; main handles edits and command execution
  - Keep edits minimal; gate saves behind green checks (format/lint/type)

### Phase B — Multi-language Support (Top 10; emphasis: JS/TS/React/Flutter/Dart/Python)
- Deliverables
  - [ ] Language adapters: TS/JS (tsserver), Python (pyright/jedi), Dart/Flutter (dart analysis server), Go, Rust, Java, C/C++, C#, PHP, Ruby (tree-sitter fallback)
  - [ ] Per-language formatters/type-check/linters wired into pre-checks
  - [ ] AST-aware edit capabilities where available; fallback to structural/regex guarded edits
- Implementation Notes
  - Pluggable adapter interface for parse/symbols/format/typecheck/refactor

### Phase C — Scalable Retrieval for Monorepos
- Deliverables
  - [ ] Indexer service: summaries, embeddings, dep graph, watch mode
  - [ ] Vector store (sqlite-vss/pgvector/FAISS) + sharding for very large repos
  - [ ] Working Set panel in UI; budgeter to keep prompt windows small
- Implementation Notes
  - Incremental indexing; ignore rules; per-language dependency graphs

### Phase D — Advanced Refactors & Test Impact
- Deliverables
  - [ ] Cross-file refactors using symbol graph
  - [ ] Test impact analysis to scope verification runs
  - [ ] Neighborhood expansion in retrieval (imports/tests/docs)
- Implementation Notes
  - Confidence scoring feeding auto-approve policy

## Tools/IPC Surface (incremental)
- search_project(query, globs?, max_results?)
- view_file(path, range?)
- run_command(cmd, cwd?, timeout?, safe?)
- run_tests(target, scope)
- apply_patch(diffs[], preview?)

## Permission Policy
- Allowed without prompt: tests, linters, type-checkers, builds
- Requires confirmation: installs, migrations, deploys, destructive fs
- Auto-approve toggle: when enabled and confidence >= threshold, proceed without prompt (log and surface diffs/decisions in UI)
- Always show diffs before writes; summarize executions

## Milestone Checklists
- M1 (Agentic Core): apply_patch + pre-check gates + run_command/tests + AST-aware TS + diff UI + approvals/auto-approve
- M2 (Multi-language): adapters for Dart/Python/Go/Rust/Java/C#/C/C++/PHP/Ruby + per-language pre-checks
- M3 (Retrieval@Scale): indexer + vector store + dep graph + working set + budgeter
- M4 (Advanced): cross-file refactors + test impact + neighborhood expansion

## Tracking Notes
- We will update this file as decisions are made in each section below.

---

# Decision Log

## 1) Runtime/Platform
- Decision: Electron desktop is primary (confirmed)

## 2) Primary Stack/Languages
- Decision: Support top ~10 languages/frameworks, with emphasis on JS/TS/React/Flutter/Dart/Python. Broader list to plan: JS/TS, Python, Java, C#, Go, C/C++, PHP, Ruby, Rust, Dart/Flutter.

## 3) LLM Provider(s)
- Decision: Prioritize Gemini and Anthropic. Keep OpenAI (existing) as secondary. Local models are a stretch goal.

## 4) Repo Scale
- Decision: Must handle very large repos and monorepos. Design for incremental indexing, sharded vector stores, and on-demand retrieval.

## 5) OS Targets
- Decision: Windows and Linux are top priorities; macOS supported; iOS is a stretch goal (note: Electron does not target iOS; mobile support would require a different runtime like React Native/Flutter).

## 6) Immediate Priorities
- Decision: Skip read-only; go straight to advanced capabilities (writes, verification, AST-aware refactors). Roadmap reordered accordingly.

## 7) Permission Defaults
- Decision: Use default safe policy, plus an Auto-approve toggle that executes without prompts when confidence ≥ threshold; always log actions and show diffs.

