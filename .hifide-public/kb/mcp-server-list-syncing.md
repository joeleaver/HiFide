---
id: f90c872c-7b00-4df6-8b09-2b80df5cb125
title: MCP server list syncing
tags: [mcp, state, store]
files: [src/store/mcpServers.ts]
createdAt: 2025-12-11T04:28:32.873Z
updatedAt: 2025-12-11T20:45:19.352Z
---

MCP server configuration is global again. The renderer store (`src/store/mcpServers.ts`) no longer partitions snapshots into "global" vs workspace slices or tracks `latestGlobalServers/latestWorkspaceServers`. Both hydration (`mcp.listServers`) and the `mcp.servers.changed` notification now deliver a single, already-sorted array of snapshots, and `setServers` simply sorts and stores that list. This removes the stale-cache bug where disabling a workspace-scoped server would drop it entirely. All tool filtering is handled later in the tools node rather than at the server list layer.