---
id: e9abadae-57c3-440a-b900-e4c10194e068
title: Flow Engine Context Architecture Refactor Plan
tags: [flow-engine, architecture, context, llm, refactor]
files: []
createdAt: 2025-12-03T16:49:29.713Z
updatedAt: 2025-12-03T16:49:29.713Z
---

# Flow Engine Context Architecture Refactor Plan

## Goals
- Single source of truth per context (main + any isolated/child contexts).
- Single writer per context via a ContextManager API.
- Nodes treat context as immutable input; all mutations go through ContextManager.
- LMService appends history via ContextManager; never rebuilds history from scratch.
- Scheduler owns mainContext and mirrors it to SessionService.
- Support multi-context flows (newContext, injectMessages, manualInput/userInput) via per-context managers and context handles.

## Key Components

### MainFlowContext
- Represents conversation context (provider, model, systemInstructions, messageHistory, contextType, contextId, etc.).
- `contextType` can be `main` or `isolated` (and possibly others like `portal`).

### ContextManager
- Per-context manager responsible for all mutations.
- API (per context):
  - `get(): MainFlowContext` — snapshot of current context.
  - `addMessage(message)` — append single message to messageHistory.
  - `addMessages(messages[])` — append multiple messages.
  - `setSystemInstructions(text)` — set/replace system instructions.
  - `setProviderModel(provider, model)` — set provider/model for this context.
  - `resetHistory()` — clear messageHistory when explicitly required.
- Internally holds a ref `{ current: MainFlowContext }` and normalizes invariants (always array messageHistory, contextType defaults to `main` for main context).

### Scheduler
- Owns:
  - `mainContext: MainFlowContext`.
  - `mainContextRef: { current: MainFlowContext }`.
  - `mainContextManager: ContextManager`.
  - `contexts: Map<contextId, MainFlowContext>` and `contextManagers: Map<contextId, ContextManager>` for isolated/child contexts.
- For each node execution:
  - Determine active context id (default main; may be overridden by node config/data for isolated flows).
  - `contextIn = activeManager.get()` — snapshot passed into node as read-only `context` argument.
  - `flow.context = activeManager` — nodes use this manager to mutate.
  - After node completes: `contexts[activeId] = activeManager.get()`.
  - For `main`, update `mainContext` and call `flushToSession()` to mirror into SessionService.
- **Important:** Scheduler no longer overwrites `mainContext` from `result.context` for main flows. Child/isolated contexts are handled through explicit APIs, not by blindly adopting `result.context`.

### LMService
- Accepts `flowAPI` with `flow.context` as a ContextManager.
- For non-skipHistory calls:
  - `const ctx = flow.context.get()` — snapshot for provider/model, system instructions.
  - Derive effective provider/model from override or context.
  - `flow.context.addMessage({ role: 'user', content: message })`.
  - `const latest = flow.context.get()` — now includes the user message.
  - Format messages for provider from `latest`.
  - Call provider; accumulate `response` and `reasoning`.
  - `flow.context.addMessage({ role: 'assistant', content: response, reasoning })`.
- Returns `{ text, reasoning?, error? }` only — does not return updatedContext.
- For skipHistory, uses context for formatting but **does not** mutate history.

### Nodes
- Node signature conceptually:
  - `node(flow: FlowAPI & { context: ContextManager }, context: MainFlowContext, dataIn, inputs, config)`.
- Rules:
  - Treat `context` argument as immutable snapshot.
  - Use `flow.context` (ContextManager) for any mutations.
  - Do not construct/return `MainFlowContext` blobs for main; `result.context` is deprecated for main flows.

#### llmRequest Node
- Resolves message + overrides (provider/model/temperature, etc.).
- Calls `llmService.chat({ message, overrideProvider, overrideModel, tools, responseSchema, skipHistory, flowAPI: flow })`.
- Returns `{ data: result.text, status: 'success' | 'error', error?: string }`.
- Does not return context for main.

#### userInput / manualInput Nodes
- Capture user input.
- Use `context` for display/prompting only.
- If they should write user input into history:
  - `flow.context.addMessage({ role: 'user', content: userInput })`.
- Return `{ data: userInput, status: 'success' }`.
- Do not return context for main flows.

#### newContext Node (Isolated Contexts)
- Creates a new isolated context:
  - Base on current context or inputs as needed.
  - Build initial `MainFlowContext` with `contextType: 'isolated'` and a fresh `contextId`.
  - Ask scheduler/flow to `createContext(initial)` which:
    - Creates a new `ContextManager` bound to that context.
    - Registers it in `contexts` and `contextManagers`.
- Returns a **handle**, not a full context, e.g. `{ data: { contextId }, status: 'success' }`.

#### injectMessages Node
- Accepts a target context (main or isolated) via config or data (`contextId`).
- Uses appropriate manager:
  - Main: `flow.context`.
  - Isolated: `flow.getContextManager(contextId)`.
- Calls `manager.addMessages([...])` to append user/assistant/system messages.
- Returns a small payload, optionally including `contextId` for routing, but does not return full context to overwrite scheduler state.

## Invariants & Guarantees
- `messageHistory` is only mutated via `ContextManager.addMessage(s)` and `resetHistory`.
- LMService never rebuilds history from just the last pair; it always appends to the existing history.
- Scheduler is the sole owner of each context; nodes cannot overwrite it by returning arbitrary `context` blobs.
- Multi-context flows are represented by multiple ContextManagers keyed by `contextId`, each with its own single writer.

## Migration Notes
- Existing behavior where nodes return `result.context` to update main context should be migrated to use ContextManager.
- For child/isolated contexts, nodes should pass around context ids/handles instead of full contexts, and use `flow.getContextManager(id)`.
- Tests should cover:
  - Multi-turn history growth (main context).
  - newContext + injectMessages + LM calls on isolated context without affecting main.
  - manualInput/userInput writing to the appropriate context.
