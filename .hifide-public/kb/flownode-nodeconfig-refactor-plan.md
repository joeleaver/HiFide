---
id: 040b9ab4-935c-4e59-a846-ac9d874d1373
title: FlowNode NodeConfig refactor plan
tags: [flow-node, refactor, frontend, plan]
files: [src/components/FlowNode/NodeConfig.tsx, src/components/FlowNode/configSections/DefaultContextConfig.tsx, src/components/FlowNode/configSections/ManualAndUserConfig.tsx, src/components/FlowNode/configSections/ReadFileConfig.tsx, src/components/FlowNode/configSections/NewContextConfig.tsx, src/components/FlowNode/configSections/PortalConfigs.tsx, src/components/FlowNode/configSections/GuardConfigs.tsx, src/components/FlowNode/configSections/LLMRequestConfig.tsx, src/components/FlowNode/configSections/ModerationConfigs.tsx, src/components/FlowNode/configSections/IntentRouterConfig.tsx, src/components/FlowNode/configSections/CacheConfig.tsx, src/components/FlowNode/configSections/ToolsConfig.tsx, src/store/knowledgeBase.ts, src/store/flowTools.ts, src/store/nodeCacheInspector.ts]
createdAt: 2025-12-04T17:10:32.270Z
updatedAt: 2025-12-04T17:17:28.159Z
---

## Goal
Shrink `src/components/FlowNode/NodeConfig.tsx` (>1k LOC) into modular, testable units with zero inline data-fetching side effects and a clear separation between renderer UI and business logic.

## Architecture decisions
1. **Store-sourced data only:**
   - Provider/model metadata now flows through `useSessionUi`; no component-local hydration.
   - Workspace file pickers use `useWorkspaceUi` + the extended `useKnowledgeBase.refreshWorkspaceFiles()` action.
   - Tool catalog (`useFlowToolsStore`) and node cache snapshots (`useNodeCacheStore`) encapsulate backend RPCs so UI stays pure.

2. **Config section modules:** Each node type renders through a focused component under `FlowNode/configSections/` (e.g., `DefaultContextConfig`, `ReadFileConfig`, `LLMRequestConfig`). `NodeConfig.tsx` is an orchestrator that wires store data + derived booleans into those sections.

3. **No `useEffect` in NodeConfig:** Imperative work (loading tools, workspace files, cache inspection) happens inside store actions. Sections trigger those actions synchronously when needed; the stores gate duplicate calls.

4. **Shared UI helpers:** Reused styles (section wrappers, textarea styles, table rows) live with their sections, keeping the orchestrator under ~250 LOC while preserving the Mantine look & feel.

## Implemented artifacts
- `src/components/FlowNode/configSections/*` – extracted section components.
- `src/store/flowTools.ts` – tool inventory store with one-time hydration + grouping.
- `src/store/nodeCacheInspector.ts` – cache snapshot/invalidation store.
- `src/store/knowledgeBase.ts` – new `workspaceFilesLoading` flag + `refreshWorkspaceFiles` action for pickers.
- `src/components/FlowNode/NodeConfig.tsx` – slim orchestrator with provider snapshot hook and zero effects.

Use this doc as the reference for future node config additions (add a new section component + register it in `NodeConfig.tsx`).