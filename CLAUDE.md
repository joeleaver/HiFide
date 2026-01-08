# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiFide is an Electron-based "Agentic-first IDE" that combines a code editor with an AI flow execution engine. The app uses WebSocket JSON-RPC for all frontend-backend communication (not Electron IPC).

## Commands

### Development
```bash
pnpm dev          # Start dev server (Vite + Electron)
pnpm build        # TypeScript compile + Vite bundle + native rebuild + package
pnpm lint         # ESLint
```

### Testing
```bash
pnpm test                    # Run all tests
pnpm test -- --testPathPattern="pattern"  # Run specific tests
pnpm test:watch              # Watch mode
pnpm test:coverage           # With coverage
pnpm test:live               # Live API calls (TEST_MODE=live)
pnpm test:record             # Record API responses (TEST_MODE=record)
```

### Native Modules
```bash
pnpm rebuild:native   # Rebuild node-pty, sharp, tree-sitter for Electron
```

## Architecture

### Process Model
- **Main process** (`electron/`): Node.js backend with services, flow engine, AI providers
- **Renderer process** (`src/`): React UI with Zustand stores
- **Worker threads**: Background indexing via `GlobalIndexingOrchestrator`
- **WebSocket JSON-RPC**: All IPC between renderer and main process

### Directory Structure
```
electron/
├── main.ts                    # App entry point
├── backend/ws/                # WebSocket JSON-RPC server & handlers
├── services/                  # Service layer (25+ services)
├── flow-engine/               # Agentic flow scheduler & execution
├── providers-ai-sdk/          # LLM provider adapters (OpenAI, Anthropic, etc.)
├── tools/                     # Agent tool registry & implementations
└── config/, utils/, session/  # Supporting modules

src/
├── store/                     # Zustand stores (chatTimeline, editor, flowEditor, etc.)
├── components/                # React components
└── services/                  # Frontend services (PTY client, etc.)

shared/                        # Types shared between main & renderer
```

### Key Patterns

**Service Registry**: All backend services registered in `ServiceRegistry` singleton, accessed via getter functions (e.g., `getSessionService()`).

**WebSocket Handlers**: Located in `electron/backend/ws/handlers/`. Each handler file exports a function returning method → handler mappings for JSON-RPC.

**Flow Engine**: The scheduler (`electron/flow-engine/scheduler.ts`) executes node graphs with support for:
- LLM requests with tool calls
- User input nodes (pause/resume)
- Caching, intent routing, portal composition

**Provider Adapters**: All LLM providers implement a common interface in `electron/providers-ai-sdk/`. Rate limiting tracked in `electron/providers/rate-limit-tracker.ts`.

**Agent Tools**: Registered in `electron/tools/agentToolRegistry.ts`. Tools are workspace-scoped and can include MCP server tools.

### Data Storage
- `.hifide-public/`: Flows, kanban, KB (markdown), memories.json
- `.hifide-private/`: Sessions, API keys (via Electron Store)
- `.hifide/vectors/`: LanceDB vector indices

### State Management
Renderer uses Zustand stores in `src/store/` with immer middleware. Key stores:
- `chatTimeline`: Session messages and timeline
- `flowEditor`: Flow graph editing state
- `flowRuntime`: Active flow execution state
- `editor`: Monaco editor state

## Code Conventions

### ESLint Rules
- `window.llm` is forbidden in renderer (use Zustand store actions instead)
- React hooks rules enforced

### Path Aliases
- `@/*` maps to `src/*` in renderer code

### Test Files
- Located in `**/__tests__/` directories
- Use `.test.ts` or `.spec.ts` extensions
- Tests can use `TEST_MODE=live` or `TEST_MODE=record` for API testing
