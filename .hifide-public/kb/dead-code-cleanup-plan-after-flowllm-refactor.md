---
id: f7354a63-b45d-4cd8-bec4-1e97769e14d3
title: Dead code cleanup plan after flow/LLM refactor
tags: [flow-engine, llm, refactor, plan]
files: [electron/flow-engine/scheduler.ts, electron/flow-engine/flow-api-factory.ts, electron/flow-engine/llm-service.ts, electron/flow-engine/llm/payloads.ts, electron/flow-engine/flow-graph.ts]
createdAt: 2025-12-04T16:09:02.767Z
updatedAt: 2025-12-04T16:16:25.968Z
---

## Scope
- `electron/flow-engine` (FlowScheduler, Flow API factory, context registry, LLM service helpers)
- Renderer listeners that consumed removed exports (check `.hifide-public/kb` references).

## Plan
1. **Detect unused exports**
   - Run `pnpm lint -- --rule '@typescript-eslint/no-unused-vars:error' electron/flow-engine` to surface unused imports/locals introduced during the extraction.
   - Supplement with `rg --files-with-matches "unused" electron/flow-engine` to find `// TODO: remove` comments left behind during the earlier partial refactor.
2. **Cross-reference modules**
   - For each helper removed from `scheduler.ts` or `llm-service.ts`, verify there is exactly one implementation under `flow-api-factory.ts` or `llm/payloads.ts`.
   - Use `rg "buildContextsHelper" -n` to ensure the previous definition was deleted everywhere else.
3. **Prune and rename**
   - Delete unused helper functions, duplicated constants, and stale type exports.
   - Normalize naming: ensure only `FlowApiFactory` exposes context helpers; LMService imports shared payload helpers instead of private copies.
4. **Regression checklist**
   - Run `pnpm lint electron/flow-engine` and `pnpm test flow-engine` (or the closest existing target) to verify no regressions.
   - Update KB summary with any architectural deltas uncovered during the cleanup.

## 2025-01-02 Cleanup Result
- `FlowScheduler` no longer carries its own `canonicalizeHandleName`/`buildGraphStructure` implementation; it now imports `buildFlowGraph` so `flow-graph.ts` is the single source of truth for edge normalization and portal bridging.
- `incomingEdges` / `outgoingEdges` maps are initialized via the factory at construction time, eliminating the unused `graph` property and preventing undefined map usage.
