---
id: 1653c687-9b5e-4f0c-ac33-41b950ffe1ae
title: MCP configuration screen and renderer data flow
tags: [mcp, renderer, ui]
files: [src/components/mcp/McpServerDrawer.tsx, shared/mcp.ts, src/components/mcp/McpPane.tsx]
createdAt: 2025-12-08T19:46:35.014Z
updatedAt: 2025-12-08T20:38:11.430Z
---

Augmented renderer notes: the MCP drawer now defaults to JSON import but exposes a manual editor that supports `stdio`, `websocket`, and `http` transports. HTTP entries capture an endpoint URL plus optional header rows, and snippet parsing understands Continue/Claude style blobs that declare `type: 'http'`, httpUrls, or generic endpoint fields. Manual edits rehyrdate env/header lists when editing a saved server, serialize back via `serializeSnapshotToSnippet`, and `buildPayload` produces the correct `CreateMcpServerInput`. This allows the Activity Bar MCP screen to onboard streamable HTTP servers alongside stdio/websocket instances.