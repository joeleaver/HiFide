---
id: cbf5c8cc-4030-49d5-ba68-b5c96277224c
title: Legacy documentation index
tags: [documentation, legacy, index]
files: [AGENT_SELF_REGULATION.md, TESTING_QUICKSTART.md, docs/apply-patch-guide.md, docs/apply-patch-example-for-llm.md, docs/connection-colors.md, docs/flow-execution-architecture.md, docs/flow-execution-migration-plan.md, docs/flow-status-cleanup.md, docs/node-label-persistence-fix.md, docs/node-title-formatting.md, docs/execution-event-phase1-complete.md, docs/execution-event-phase2-complete.md, docs/execution-event-refactor-proposal.md, docs/execution-event-testing-plan.md, docs/execution-event-testing.md]
createdAt: 2025-11-03T21:28:54.248Z
updatedAt: 2025-11-03T21:28:54.248Z
---

## Imported documents
- **AGENT_SELF_REGULATION.md** – Describes the self-regulation toolchain (`agent.assess_task`, `agent.check_resources`, `agent.summarize_progress`) to bound token/iteration usage; includes budgeting heuristics and warning thresholds.
- **TESTING_QUICKSTART.md** – Quick-start for running Jest suites with recorded fixtures, adding new node tests, and optionally recording real API interactions via `.env.test`.
- **docs/apply-patch-guide.md** & **docs/apply-patch-example-for-llm.md** – Usage guide and working example payloads for the `apply_patch` tool, covering required diff headers, wrapper formats, and sample patches.
- **docs/connection-colors.md** – Centralized color scheme for flow editor edges with helper utilities under `electron/store/utils/connection-colors.ts`.
- **docs/flow-execution-architecture.md** – Deep dive into lazy, node-driven flow execution design and scheduler responsibilities.
- **docs/flow-execution-migration-plan.md** / **docs/flow-status-cleanup.md** / **docs/node-label-persistence-fix.md** / **docs/node-title-formatting.md** – Migration notes and cleanup plans for flow execution status, node metadata persistence, and UI formatting.
- **docs/execution-event-*.md** – Series detailing execution event refactor (phase completion reports, testing plans, refactor proposals) introducing unified event schemas.

## Usage notes
- Treat these as historical context; cross-check with current code (notably under `electron/ipc/` and `electron/tools/`) before acting on the guidance.
- Many documents reference files that may have moved; validate paths (e.g., flow execution under `electron/ipc/flowProfiles.ts` and related modules).
