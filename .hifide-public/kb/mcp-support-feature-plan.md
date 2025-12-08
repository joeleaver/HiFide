---
id: 025cd1e5-7c68-438b-93fb-6f402298eaf3
title: MCP support feature plan
tags: [design, mcp, planning]
files: [electron/services, electron/backend/ws/handlers, electron/tools, electron/flow-engine, src/store, src/components, src/App.tsx, src/components/ActivityBar.tsx, src/store/ui.ts]
createdAt: 2025-12-08T18:42:29.358Z
updatedAt: 2025-12-08T18:42:29.358Z
---

## Goals
- Deliver first-class Model Context Protocol (MCP) support so users can register one or more MCP servers, inspect their resources/tools, and toggle them on/off per workspace.
- Ensure MCP tools become available to the agent runtime (Flow/LLM) via the standard tool pipeline so OpenAI/Anthropic/Gemini providers can invoke them without special-case code.
- Persist server definitions securely in the main process and expose real-time status/health to the renderer.

## Non-Goals
- Building a brand-new MCP server implementation (we only connect to user-provided servers).
- Shipping enterprise auth or remote fleet management in this iteration.

## Architecture Overview
1. **McpService (electron/services/McpService.ts)**
   - Persists server definitions (command/url/env) and maintains runtime state (status, discovered tools/resources, last error).
   - Wraps `@modelcontextprotocol/sdk` clients, handles process spawning for `stdio` transports, reconnects when autoStart=true, and exposes `invokeTool()`.

2. **Backend RPC/Events**
   - New handler module `electron/backend/ws/handlers/mcp-handlers.ts` providing `mcp.listServers`, `mcp.createServer`, `mcp.updateServer`, `mcp.deleteServer`, `mcp.toggleServer`, `mcp.refreshServer`, `mcp.testServer`.
   - `event-subscriptions.ts` broadcasts `mcp.servers.changed` whenever definitions or runtime state mutate so the renderer stays in sync.

3. **Renderer Screen & Store**
   - New top-level view `'mcp'` reachable from the ActivityBar.
   - Zustand store `src/store/mcpServers.ts` plus `useMcpHydration = createScreenHydrationStore('mcp')` to cache the latest snapshot and drive loading UX.
   - `McpPane` React component renders: summary, table of servers with status badges, collapsible tool/resource list, and a drawer/modal for add/edit/test flows.

4. **Provider Wiring**
   - `McpService` exposes `getAgentTools()` returning `AgentTool` definitions (name prefixed with `mcp.<serverSlug>.<toolName>`).
   - `electron/tools/index.ts` exports `getStaticAgentTools()` and `getAllAgentTools()`; `globalThis.__agentTools` becomes a function returning `static + getMcpService().getAgentTools()`.
   - `flow-api-factory.ts` updates `flow.tools.list()` to call the function when available. No Flow node changes required; the tools node will start surfacing MCP entries automatically.

5. **Safety & Observability**
   - All MCP tool invocations funnel through `McpService.invokeTool` where we can log inputs/outputs, enforce payload limits, and surface failures to the renderer.

## Data Shapes
```ts
type McpTransport = { kind: 'stdio'; command: string; args: string[]; cwd?: string } |
                    { kind: 'websocket'; url: string; headers?: Record<string,string> }

interface McpServerConfig {
  id: string
  label: string
  transport: McpTransport
  env: Record<string, string>
  autoStart: boolean
  enabled: boolean
}

interface McpRuntimeState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  lastError?: string
  lastSeen?: number
  tools: Array<{ name: string; description?: string; schema: any }>
  resources: Array<{ uri: string; name?: string; mimeType?: string }>
}
```
`McpService` stores `{ configs: Record<string, McpServerConfig>, runtime: Record<string, McpRuntimeState> }` under the `mcp` persistence key.

## Backend Work Breakdown
1. **Service + Client wrapper**
   - Create `electron/services/McpService.ts` managing configs, runtime, process lifecycles, and bridging to `@modelcontextprotocol/sdk`.
   - Add getters/setters (`listServers`, `upsert`, `remove`, `toggleEnabled`, `connect`, `disconnect`, `refreshMetadata`, `invokeTool`).
   - Emit `mcp:servers:changed` whenever configs or runtime change so event subscribers can notify renderers.
   - Register service inside `electron/services/index.ts` (new `getMcpService()`).

2. **RPC Handlers**
   - Add `electron/backend/ws/handlers/mcp-handlers.ts`; wire it up in `handlers/index.ts` and the WS router.
   - Each RPC calls into `McpService`, returns normalized payloads (`{ ok, servers: McpServerSnapshot[] }`).
   - Extend `event-subscriptions.ts` to listen to `mcp:servers:changed` and send `mcp.servers.changed`.

3. **Tool Registry**
   - Update `electron/tools/index.ts` to export `getStaticAgentTools()` and `getAllAgentTools()`.
   - During app init (`electron/main.ts`), assign `globalThis.__agentTools = () => getAllAgentTools()`.
   - Modify `flow-api-factory.ts` so `flow.tools.list()` executes the function if provided (fall back to array for backwards compatibility).

4. **Provider adapters**
   - No direct changes required to specific provider adapters; `llm-service` keeps receiving tool arrays from the flow graph.
   - Add a helper (e.g., `electron/mcp/agentTools.ts`) that converts each MCP tool to an `AgentTool` with `run` invoking `McpService.invokeTool` and `toModelResult` stripping bulky payloads.

5. **Testing/Diagnostics**
   - Add Jest unit tests in `electron/services/__tests__/McpService.test.ts` covering config persistence, tool mapping, and reconnection logic.
   - Add backend handler tests to ensure RPC payloads serialize correctly.

## Renderer Work Breakdown
1. **Routing + View state**
   - Update `src/store/ui.ts`, `shared/store/types.ts`, and `ActivityBar.tsx` to add `'mcp'` as a valid view with a Tabler icon.
   - Update `src/App.tsx` to render a new `<McpPane />` when `currentView === 'mcp'`.

2. **State management**
   - Create `src/store/mcpServers.ts` storing `{ servers: McpServerSnapshot[], loading, error }` and exposing actions `fetch`, `create`, `update`, `remove`, `toggle`, `refresh`.
   - Use `getBackendClient` + RPC to populate state and subscribe to `client.subscribe('mcp.servers.changed', …)`.
   - Reuse `createScreenHydrationStore('mcp')` for skeleton/loading states.

3. **UI Components**
   - `src/components/mcp/McpPane.tsx`: orchestrates hydration, error empty states.
   - `McpServerList`: Mantine table/accordion showing name, transport, status badges, tool count, auto-start toggle, and CTA buttons.
   - `McpServerDrawer`: form with inputs for label, transport type, command/url, env key-value pairs, auto-start, with inline test button.
   - `McpToolList`: displays discovered MCP tools/resources per server with copy-able JSON schema.

4. **UX behaviors**
   - Optimistic updates on save, toast errors via Mantine notifications.
   - Inline “Test connection” action invoking `mcp.testServer`.

5. **Styling & Accessibility**
   - Match SettingsPane spacing (`Stack gap="md"`); ensure focus trapping inside drawers and announce status updates.

## Provider Wiring Details
- Agent tool naming: `mcp.<serverSlug>.<toolName>` ensures uniqueness and lets us reverse-map to server + tool when a provider invokes it.
- `run(args, meta)` uses `McpService.invokeTool(serverId, toolName, args, meta?.requestId)` which ensures the server is connected, calls `client.callTool`, and returns `{ minimal, ui }` so `llm-service` receives compact output while UI can fetch full payloads later.
- Resource handling: `McpService` exposes helper `fetchResource(serverId, uri)` for future use; not required for first release but plan to persist previews under `.hifide-private/mcp-cache`.

## Testing & Observability
- **Unit tests** for `McpService` (mock `@modelcontextprotocol/sdk`).
- **RPC contract tests** verifying validation and failure propagation.
- **Renderer tests** for `McpPane` form validation.
- Manual E2E checklist: add stdio server, verify auto-start, run Flow that uses MCP tool, inspect logs.
- Logging: instrument `McpService` with `[mcp] server ${id} …` logs; expose UI toggle to show raw MCP protocol logs.

## Task Breakdown
1. **Infrastructure & Service Layer** – implement `McpService`, register it, add RPC handlers, and tests.
2. **Renderer UX** – build `McpPane`, hydration logic, and CRUD flows.
3. **Provider/Tool wiring** – switch tool registry to dynamic resolver, expose MCP tools, verify flow nodes receive them, and update QA playbook.

Open questions: workspace scoping vs. global configs, and whether MCP secrets should leverage the OS keychain. Current plan persists env vars with light obfuscation; integrate keytar later if required.