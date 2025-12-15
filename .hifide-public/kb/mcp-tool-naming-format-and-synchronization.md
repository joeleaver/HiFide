---
id: c1d62241-4125-4da5-bb6e-99601373959f
title: MCP tool naming format and synchronization
tags: [mcp, tools, flow-node]
files: [electron/services/McpService.ts, electron/flow-engine/nodes/tools.ts, src/components/FlowNode/configSections/ToolsConfig.tsx]
createdAt: 2025-12-11T05:23:18.949Z
updatedAt: 2025-12-11T05:23:18.949Z
---

- MCP tool identifiers now use underscores (`mcp_<slug>_<toolName>`) instead of dotted segments. The backend emits these names via `buildMcpToolName` in `electron/services/McpService.ts`, which trims whitespace and replaces spaces or dots with underscores before concatenating the slug and tool name.
- The Flow tools node (`electron/flow-engine/nodes/tools.ts`) matches the new `mcp_` prefix and extracts plugin IDs by slicing off the prefix and reading the next underscore-delimited segment. This keeps plugin gating (`mcpPlugins` overrides and legacy `mcpEnabled`) working after the rename.
- The Tools configuration UI (`src/components/FlowNode/configSections/ToolsConfig.tsx`) treats both old (`mcp.`) and new (`mcp_`) identifiers as MCP entries, but normalization + merge logic now writes only the underscore form. When an MCP plugin is toggled on, the UI injects every `mcp_<slug>_<tool>` into `config.tools`, ensuring linked LMs see the whole toolset.
- Existing configs containing legacy dotted names are migrated automatically because the UI filters them as MCP selections and rewrites the list with the new names on the next save.