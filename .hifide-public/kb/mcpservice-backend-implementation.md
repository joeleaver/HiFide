---
id: 26041b6d-f60d-4b7f-87eb-63754b7a59db
title: McpService backend implementation
tags: [mcp, backend, services]
files: [electron/services/McpService.ts, electron/backend/ws/handlers/mcp-handlers.ts, electron/backend/ws/event-subscriptions.ts, src/store/mcpServers.ts]
createdAt: 2025-12-08T19:11:40.010Z
updatedAt: 2025-12-11T20:45:26.072Z
---

McpService now keeps a single global registry of MCP servers regardless of workspace. The service sanitizes any persisted `workspaceId` fields to `null` on startup, `listServers()` always returns the full set, and CRUD/test APIs no longer require (or enforce) a workspace argument. Eventing was simplified: `emitServersChanged` emits one `{ workspaceId: null, servers }` snapshot, and `maybeEmitToolsChanged` fingerprints the global tool list instead of tracking per-workspace maps. Downstream consumers (agent tool registry, tools node, renderer stores) gate MCP usage via their own configuration rather than the service. Relevant files: `electron/services/McpService.ts`, `electron/backend/ws/handlers/mcp-handlers.ts`, `electron/backend/ws/event-subscriptions.ts`, `src/store/mcpServers.ts`.