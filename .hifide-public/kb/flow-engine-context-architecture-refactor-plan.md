---
id: 3ce46712-af2f-45b9-91b6-b25e9f64e85b
title: Flow Engine Context Architecture Refactor Plan
tags: [flow-engine, architecture, context, design]
files: [electron/flow-engine/scheduler.ts, electron/flow-engine/llm-service.ts, electron/flow-engine/nodes/userInput.ts, electron/flow-engine/nodes/llmRequest.ts, electron/services/SessionService.ts]
createdAt: 2025-12-03T00:26:18.680Z
updatedAt: 2025-12-03T00:26:18.680Z
---

# Flow Engine Context Architecture Refactor Plan

## Goals

1. **Single Source of Truth for Context**
   - `FlowScheduler.mainContext` is the canonical runtime conversation context.
   - All persisted session context is derived from `mainContext`.

2. **Single Writer for Context**
   - A dedicated **Context API** (ContextManager) is the *only* component allowed to mutate `mainContext`.
   - Nodes treat context as **immutable input**; they cannot replace or arbitrarily mutate context objects.

3. **Append-Only, Correct History Management**
   - `messageHistory` must be updated via explicit, append-only operations (`addMessage`, `addMessages`, `truncateInvalidTail`, etc.).
   - No ad-hoc reconstruction of history from a last user/assistant pair.

4. **Clear Separation of Responsibilities**
   - **Scheduler**: owns `mainContext`, calls nodes, applies context updates from Context API, and flushes to session.
   - **Nodes**: pure-ish functions over input context/data; communicate desired context changes via Context API only.
   - **LMService**: uses Context API to append user/assistant messages; does *not* return authoritative context objects.

---

## Current Problems

1. **Nodes Can Overwrite mainContext**
   - Scheduler currently accepts `result.context` from nodes and assigns it directly to `this.mainContext`.
   - Any node can accidentally blow away provider/model/contextId/messageHistory.

2. **Context API Not Canonical**
   - `flow.context` is created per node and not clearly bound to `scheduler.mainContext`.
   - Some code (e.g., LMService) treats `flow.context` as authoritative while the scheduler treats `result.context` as authoritative.

3. **History Overwrite Symptoms**
   - Logs show nodes (e.g., `userInput`) receiving contexts with `contextId`, `provider`, and `model` undefined.
   - LM nodes then execute with malformed contexts, and the resulting context flushed to session loses prior history.

---

## Target Architecture

### 1. Context Ownership

- `FlowScheduler.mainContext: MainFlowContext` is the **only** in-memory owner of the conversation context for a run.
- `SessionService.currentContext` is a serialized mirror, updated only by the scheduler (via flush).

### 2. Context API (ContextManager)

Introduce or formalize a `ContextManager` that:

- Holds an internal reference to `mainContext` (or a store controlled by the scheduler).
- Exposes **only high-level operations**:
  - `get(): MainFlowContext` (immutable snapshot)
  - `addMessage(message: Message)`
  - `addMessages(messages: Message[])`
  - `setSystemInstructions(text: string)`
  - `setProviderModel(provider: string, model: string)`
  - Potentially `resetHistory()` or `forkContext()` for explicit flows.
- Internally applies changes via a single mutation primitive (e.g., `apply(update: Partial<MainFlowContext>)`) that:
  - Is only callable from the ContextManager implementation.
  - Guarantees `messageHistory` remains an array and is updated append-only when using `addMessage(s)`.

### 3. Scheduler Responsibilities

- Construct a single `ContextManager` instance bound to `mainContext`.
- In `doExecuteNode`:
  - Pass an **immutable snapshot** of context to the node as the `context` argument.
  - Pass the `ContextManager` as `flow.context`.
  - After the node completes, **do not** adopt `result.context` as `mainContext`.
  - Instead, snapshot the updated `ContextManager.get()` value into `mainContext`.
- In `flushToSession`:
  - Mirror `mainContext` to session via `SessionService.updateContextFor`.

### 4. Node Responsibilities

- Nodes are **stateless transformers** over inputs:
  - Receive `context` (snapshot), `dataIn`, `inputs`, `config`.
  - May call `flow.context` operations to request context mutations.
  - Return data and status; `result.context` is deprecated for main context updates.
- Special cases:
  - Nodes that intentionally create or fork contexts (e.g., portal/child flows) operate through dedicated Context API calls (e.g., `createChildContext`) and return *identifiers* or explicit child-context objects, not replacements for `mainContext`.

### 5. LMService Responsibilities

- `LLMService.chat` is the *only* code that mutates `messageHistory` for normal runs:
  - Reads a snapshot of the context via `flow.context.get()`.
  - Uses `flow.context.addMessage(s)` to append the user and assistant messages.
  - Returns text (and optional reasoning) but **does not return `updatedContext` to be adopted by the scheduler**.
- For stateless calls (`skipHistory`):
  - `LLMService.chat` formats messages using a local view of the context but does not modify history.

---

## Refactor Plan

### Phase 1 – Design & Interfaces (Non-breaking)

1. **Define ContextManager Interface**
   - In a shared module, formalize an interface for context operations used by nodes and LMService.
   - Ensure existing helpers (e.g., `addMessage`, `addMessages`) delegate to this API.

2. **Bind Context API to Scheduler.mainContext**
   - Update `FlowScheduler` to create a single ContextManager instance that reads/writes `mainContext`.
   - Update `createFlowAPI` so `flow.context` is this bound ContextManager, not a detached instance.

3. **Deprecate result.context for Main Context Updates**
   - Document that nodes must no longer rely on `result.context` to update main context.
   - Keep support temporarily but mark it for removal after LMService and key nodes are migrated.

### Phase 2 – LM & Critical Nodes Migration

4. **Update LLMService.chat**
   - Replace internal manual `updatedContext` / `finalContext` construction with calls to `flow.context.addMessages`.
   - Stop using `flowAPI.context` as an arbitrary object; treat it as the ContextManager.
   - Change the return type to not be authoritative for context; `updatedContext` may be removed or treated as optional debug info.

5. **Update llmRequest Node**
   - Stop returning `result.updatedContext` as `context`.
   - Treat LMService as side-effectful on context via ContextManager; node returns only `data` (the text) and `status`.

6. **Update userInput and Other Context-sensitive Nodes**
   - Ensure userInput treats its `context` argument as read-only.
   - Use ContextManager for any state changes (if needed) instead of returning a new `context`.
   - Validate that no node recreates MainFlowContext from scratch when not necessary.

### Phase 3 – Scheduler Behavior Cleanup

7. **Stop Adopting result.context for Main Context**
   - In `doExecuteNode`, remove or gate the logic that sets `this.mainContext = result.context`.
   - Replace with: `this.mainContext = contextManager.get()` after node execution.

8. **Harden flushToSession**
   - Ensure `flushToSession` only ever reads from `mainContext`.
   - Add logging for `messageHistory.length`, `provider`, `model`, `contextId` to validate invariants during runs.

### Phase 4 – Removal of Legacy Paths and Tests

9. **Remove result.context for Main Context**
   - After all nodes are migrated, delete/ignore `result.context` for main context updates.
   - Keep only explicit mechanisms for child/portal contexts.

10. **Add Regression Tests**
    - Multi-turn flows with userInput → LM → tool calls, ensuring:
      - `messageHistory` grows monotonically per session.
      - No node can reset provider/model/contextId to undefined.
    - Tests where nodes attempt to return malformed contexts and verifying that main context remains valid.

---

## Expected Outcomes

- No more accidental overwrites of `messageHistory` or key context fields by arbitrary nodes.
- `LLMService` is the single place where conversational history is appended, via a clean Context API.
- `FlowScheduler.mainContext` is the clear, enforced source of truth for context.
- Future features (e.g., branching, child flows, time travel) can be built on top of a stable context model.
