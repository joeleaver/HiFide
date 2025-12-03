---
id: 7305761e-7555-41ed-8731-c157bca72770
title: Message history architecture and persistence
tags: [architecture, messages, messageHistory, llm, context]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/context-api.ts, electron/flow-engine/nodes/defaultContextStart.ts, electron/flow-engine/nodes/newContext.ts, electron/services/SessionService.ts]
createdAt: 2025-12-02T23:30:20.708Z
updatedAt: 2025-12-02T23:30:20.708Z
---

# Message history architecture and persistence

## Overview

Message history tracks the ordered list of user/assistant messages associated with a session or flow execution. It is used to build prompts for LLM requests and to render the context inspector in the UI. Recent regressions have shown issues with message history being overwritten or mis-shared across isolated contexts.

## Key responsibilities
- Persist message history across turns in a session.
- Ensure correct isolation between independent contexts (e.g., `newContext` nodes / bootstrap flows).
- Provide sanitized, model-ready message lists for LLM providers.

## Primary components
- `electron/flow-engine/llm-service.ts`
  - Reads `context.messageHistory` and converts it into provider-specific chat formats.
  - Strips metadata fields the providers do not accept.
- `electron/flow-engine/context-api.ts`
  - Clones and merges `messageHistory` when building or updating context objects for the scheduler and flow API.
- `electron/flow-engine/nodes/defaultContextStart.ts`
  - Sanitizes message history to guarantee correctly paired user/assistant messages at the tail.
  - Receives session-level context (including message history) from the scheduler.
- `electron/flow-engine/nodes/newContext.ts`
  - Creates isolated execution contexts that should not inherit message history from parent flows.
- `electron/services/SessionService.ts`
  - Manages session context at the application level, including message history, provider, and model.

## Known pitfalls and bugs
- Message history being **overwritten** instead of **appended** when merging new context updates.
- Duplicate context objects (e.g., scheduler vs. flow API) getting out of sync.
- `messageHistory` sometimes being a non-array value, causing runtime errors (`context.messageHistory is not iterable`).
- Incorrect sharing of message history between contexts that should be isolated.

## Design constraints
- `messageHistory` must always be an **array of chat messages** in engine/internal data structures.
- LLM-specific transformations should occur at the service boundary (e.g., `llm-service.ts`) without mutating the underlying history.
- Merging context updates must treat `messageHistory` as **append-only**, unless explicitly resetting the session (e.g., `startNewContext()`).

## Open work
- Audit context merging logic across scheduler, context API, and LLM nodes.
- Add tests that:
  - Verify history is appended per-turn for a single session.
  - Verify `newContext` flows do not inherit parent history.
  - Verify sanitization preserves all prior turns while enforcing user/assistant tail pairing.
