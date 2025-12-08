---
id: 26041b6d-f60d-4b7f-87eb-63754b7a59db
title: McpService backend implementation
tags: [mcp, backend, services]
files: [electron/services/McpService.ts, electron/backend/ws/event-subscriptions.ts, electron/backend/ws/handlers/misc-handlers.ts, electron/tools/agentToolRegistry.ts, src/store/flowTools.ts, src/lib/backend/bootstrap.ts, electron/flow-engine/nodes/tools.ts, electron/flow-engine/nodes/__tests__/tools.test.ts]
createdAt: 2025-12-08T19:11:40.010Z
updatedAt: 2025-12-08T21:02:06.345Z
---

## MCP backend service

### Responsibilities
- Persist MCP server configs (transport/env/autostart) under the `mcp` persistence key.
- Maintain runtime state (status, lastSeen, pid, tool/resource metadata) and auto-reconnect when `autoStart` is enabled.
- Surface MCP tools as HiFide `AgentTool` implementations via `getAgentTools()` so providers can call them like any other tool.
- Emit high-fidelity events that hydrate both renderer stores (`mcp.servers.changed`) and the tool registry (`mcp:tools:changed`).

### New event lifecycle
- Every state mutation (config or runtime) still emits `mcp:servers:changed` for UI snapshots.
- After each emission the service now fingerprints the set of *available* tools (enabled + connected servers, plus each tool’s schema/description).
- When that fingerprint changes, the service increments `toolsVersion` and emits `mcp:tools:changed` with `{ version, servers: [{ id, slug, label, toolCount }] }`.
- `event-subscriptions.ts` relays the event to renderers as `flow.tools.changed`, which triggers the flow-tool store to refetch.

### Agent tool registry wiring
- `electron/tools/agentToolRegistry.ts` owns the combined tool list.
  - On module load it seeds `globalThis.__agentTools` with the built-in tools so legacy consumers still work.
  - `initializeAgentToolRegistry()` (called after `initializeServices()` in `main.ts`) subscribes to `mcp:tools:changed`, rebuilds the combined list (`builtin + mcpService.getAgentTools()`), and refreshes `globalThis.__agentTools`.
  - `getAgentToolSnapshot()` exposes the current list for RPC handlers (e.g., `flows.getTools`).
- Because `flow-engine` still reads `globalThis.__agentTools`, MCP-derived tools immediately become runnable by LLM nodes with no further changes in the flow engine.

### Renderer touch points
- `flowTools` store now accepts `hydrate({ force?: boolean })` and exposes `initFlowToolsEvents(client)`; the bootstrap process wires the new `flow.tools.changed` notification so the tool palette refreshes automatically when servers connect/disconnect or change their declared tools.
- MCP servers store (`initMcpEvents`) remains focused on server snapshots; flow-tool refreshes are decoupled and only run when the effective tool set actually changes (avoids rehydrating on every `lastSeen` tick).

### Flow engine propagation
- `electron/flow-engine/nodes/tools.ts` unions the operator-selected tool list with all currently connected MCP tools (namespaced `mcp.*`). Manual selections keep filtering the static/built-in tools, but MCP tools are always appended and deduplicated so LLM nodes never lose dynamic capabilities when the flow graph predates the MCP server.
- `electron/flow-engine/nodes/__tests__/tools.test.ts` now locks this behavior with a regression test covering the manual-selection + MCP-union path.

### Testing notes
- Unit tests cover:
  - HTTP transport normalization + Streamable HTTP transport wiring.
  - Tool registry emissions (`mcp:tools:changed`) by connecting/disabling a server and asserting both the emitted events and the presence of `mcp.*`-namespaced tools from `getAgentTools()`.
  - Existing CRUD / snapshot behaviors.
- Jest config maps the MCP SDK ESM entrypoints to their TS sources so the new tests compile.

### Downstream usage
- Backend RPC `flows.getTools` now resolves through `getAgentToolSnapshot()` ensuring renderers always see MCP tools in tool pickers.
- Renderers subscribe to `flow.tools.changed` and call `FlowService.getTools()` (which RPCs to `flows.getTools`) so the UI reflects the dynamic registry without a reload.
