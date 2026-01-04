---
id: 4c519988-c301-43ea-ba4b-47ff0a30bcb7
title: MCP Method Not Found Error Handling
tags: [mcp, error-handling, resources]
files: [electron/services/McpService.ts]
createdAt: 2026-01-04T03:30:10.610Z
updatedAt: 2026-01-04T03:30:10.610Z
---

## MCP 'Method not found' error (-32601)

### Symptom
On workspace startup, the log shows:
`[mcp] Failed to list resources MCP error -32601: Method not found`

### Root Cause
Many MCP servers do not implement the `resources/list` capability. The `McpService` in `electron/services/McpService.ts` calls `client.listResources()` during initialization. If the server doesn't support resources, it returns JSON-RPC error `-32601`.

### Solution
Wrap `client.listResources()` and `client.listTools()` in try-catch blocks (or handle the rejection) to ensure that servers lacking certain capabilities don't trigger warning/error logs that distract from actual issues.

### Related Files
- `electron/services/McpService.ts`