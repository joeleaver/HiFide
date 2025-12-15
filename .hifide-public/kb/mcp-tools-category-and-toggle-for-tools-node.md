---
id: 5c8dca16-7b9a-4254-9195-6d97d2c2724b
title: MCP tools category and toggle for Tools node
tags: [flow, mcp, tools]
files: [electron/services/ToolsService.ts, electron/flow-engine/nodes/tools.ts, src/components/FlowNode/configSections/ToolsConfig.tsx]
createdAt: 2025-12-11T01:48:46.384Z
updatedAt: 2025-12-11T03:19:00.281Z
---

## Overview
Tools provided by MCP (Model Context Protocol) servers now share a dedicated category, expose per-plugin toggles, and list every ready tool inside the Tools node configuration panel. Each MCP server (Playwright, RivalSearchMCP, etc.) can be enabled or disabled independently, and the manual selection accordion refreshes to show every tool that belongs to the currently enabled plugins.

## Key points
- **Category mapping (`electron/services/ToolsService.ts`)** – Tool names that start with `mcp.` are categorized as `mcp`. This keeps the renderer labeling separate from the generic "Other" bucket.
- **Workspace-scoped data flow** – The backend emits `mcp.servers.changed` / `flow.tools.changed` events with a `workspaceId`, and the renderer store (`src/store/flowTools.ts`) hydrates per workspace. Switching projects no longer leaks MCP servers between workspaces.
- **Tools node config UI (`src/components/FlowNode/configSections/ToolsConfig.tsx`)** – The panel renders one checkbox per MCP plugin using the live server snapshot (label, status, tool count, global enabled flag). Manual selection accordions show every ready MCP tool with the human-friendly name reported by the server plus its server label, so the names match the MCP management screen.
- **Flow engine behavior (`electron/flow-engine/nodes/tools.ts`)** – The tools node derives an `isPluginEnabled(pluginId)` helper that first checks `config.mcpPlugins[pluginId]`, then falls back to `config.mcpEnabled` (default `true`). The `mergeTools` helper keeps a deduped list and only appends MCP tools belonging to enabled plugins, whether they originated from static config, auto mode, or dynamic overrides.

## Implementation Notes (Jan 2026 refresh)
- `FlowService.getTools()` now returns `{ tools, mcpServers }`. Each server summary contains label, status, enabled flag, and per-tool metadata (`fullName`, original MCP name, description). The renderer store caches that tuple per workspace and ignores `flow.tools.changed` events whose `workspaceId` does not match the current binding.
- `ToolsConfig` hydrates via `useBackendBinding`, renders global/server status (Connected/Connecting/Error + whether the server is disabled in the MCP pane), and disables the per-node toggle if the server is globally disabled. Manual selection checkboxes use the metadata map to show the friendly MCP tool name and the originating server label instead of the sanitized `mcp.slug.tool` identifier.
- `mergeTools` inside `electron/flow-engine/nodes/tools.ts` still receives a plugin-aware predicate and only emits MCP tools whose plugin is enabled. Legacy configs that only set `mcpEnabled` continue to work because the predicate falls back to that boolean for any plugin lacking an explicit entry.
- Jest coverage spans both `electron/services/__tests__/McpService.test.ts` (workspace scoping + metadata events) and `electron/flow-engine/nodes/__tests__/tools.test.ts` (per-plugin gating) to guard against regressions.