---
id: 9601c413-2bd4-4b8c-bec1-d7540c2b43e2
title: Tools configuration MCP sections
tags: [ui, flow, tools, mcp]
files: [src/components/FlowNode/configSections/ToolsConfig.tsx]
createdAt: 2025-12-11T04:12:35.632Z
updatedAt: 2025-12-11T05:01:13.260Z
---

## Overview
- The Tools node UI exposes a single "MCP Tools" section that lists every configured MCP server (plugin) for the current workspace. Each entry reflects the server label, status, tool count, and whether it is globally enabled via the MCP Servers screen.
- The checkbox for each plugin acts as an all-or-nothing gate. When checked, all of that server's tools are exposed to the flow; when unchecked, they are completely withheld.

## Manual mode behavior
- Manual tool selections in the accordion now only contain first-party tools; MCP tools never appear there.
- When a plugin is enabled while the Tools node is in manual mode (i.e., "Auto" is off), the config automatically injects the full set of `mcp.<pluginId>.<toolName>` entries behind the scenes. Disabling the plugin removes them. This ensures the LLM sees the entire toolset without exposing per-tool toggles in the UI.
- The sanitization effect keeps the manual selection array in sync with the current plugin states and each plugin’s advertised tool list, so newly-added MCP tools immediately become available and removed ones no longer linger in config.

## Auto mode behavior
- When "Auto" is enabled, all tools—including MCP plugins that are globally enabled and not explicitly excluded—are available to the LLM automatically.
- Toggling MCP plugins still flips their availability in Auto mode, but no manual selection bookkeeping is required.

## Implementation touchpoints
- `src/components/FlowNode/configSections/ToolsConfig.tsx`: owns the UI, plugin toggle handling, and the synchronization logic that merges manual selections with the active MCP tool lists.
- `electron/flow-engine/nodes/tools.ts`: enforces the runtime gating, ensuring disabled plugins never leak tools even if legacy configs still contain their names.

## Gotchas
- The per-plugin checkbox is disabled if the server itself is disabled from the MCP Servers page; servers must be globally enabled to be surfaced in flows.
- The "Selected" counter in manual mode only reflects first-party tool selections. MCP tools are implied by the plugin toggles and do not contribute to that count.