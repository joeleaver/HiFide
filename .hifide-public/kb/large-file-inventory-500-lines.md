---
id: 0fbd32b6-1e53-4500-a3d3-4fdc4e85bbdb
title: Large file inventory (>=500 lines)
tags: [codebase, metrics, refactor, inventory]
files: [local_cache/fast-bge-small-en-v1.5/tokenizer.json, local_cache/fast-bge-small-en-v1.5/vocab.txt, pnpm-lock.yaml, public/hifide-logo.png, src/components/FlowNode/NodeConfig.tsx, electron/flow-engine/llm-service.ts, src/components/FlowCanvasPanel.tsx, src/components/KanbanView/KanbanView.tsx, .hifide-public/kanban/board.json, electron/flow-engine/timeline-event-handler.ts, src/styles/mdx-dark.css, docs/flow-execution-architecture.md, electron/flow-engine/scheduler.ts, docs/flow-execution-migration-plan.md, electron/services/flowProfiles.ts, electron/services/TerminalService.ts, electron/services/ProviderService.ts, src/components/SessionControlsBar.tsx, electron/services/SessionService.ts, electron/providers/__tests__/execution-events-integration.test.ts, docs/zustand-removal-plan.md, src/components/KnowledgeBaseView.tsx]
createdAt: 2025-12-04T16:44:24.147Z
updatedAt: 2025-12-04T16:44:24.147Z
---

Automated `git ls-files` + line-count audit as of current HEAD identified 22 tracked files with 500+ lines:

1. 30,672 – `local_cache/fast-bge-small-en-v1.5/tokenizer.json`
2. 30,523 – `local_cache/fast-bge-small-en-v1.5/vocab.txt`
3. 12,168 – `pnpm-lock.yaml`
4. 1,317 – `public/hifide-logo.png` (binary)
5. 1,251 – `src/components/FlowNode/NodeConfig.tsx`
6. 1,021 – `electron/flow-engine/llm-service.ts`
7.   960 – `src/components/FlowCanvasPanel.tsx`
8.   939 – `src/components/KanbanView/KanbanView.tsx`
9.   814 – `.hifide-public/kanban/board.json`
10.  749 – `electron/flow-engine/timeline-event-handler.ts`
11.  712 – `src/styles/mdx-dark.css`
12.  652 – `docs/flow-execution-architecture.md`
13.  626 – `electron/flow-engine/scheduler.ts`
14.  600 – `docs/flow-execution-migration-plan.md`
15.  574 – `electron/services/flowProfiles.ts`
16.  573 – `electron/services/TerminalService.ts`
17.  549 – `electron/services/ProviderService.ts`
18.  534 – `src/components/SessionControlsBar.tsx`
19.  524 – `electron/services/SessionService.ts`
20.  519 – `electron/providers/__tests__/execution-events-integration.test.ts`
21.  510 – `docs/zustand-removal-plan.md`
22.  501 – `src/components/KnowledgeBaseView.tsx`

Use this as the starting point for follow-up refactors; FlowScheduler/LLMService already have dedicated tasks, so next candidates are the FlowNode config UI, FlowCanvas/Kanban views, and the electron service classes called out above.