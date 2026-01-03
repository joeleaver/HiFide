---
id: 7305761e-7555-41ed-8731-c157bca72770
title: Message history architecture and persistence
tags: [architecture, messages, messageHistory, llm, context, multi-modal]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/context-api.ts, electron/flow-engine/nodes/defaultContextStart.ts, electron/flow-engine/nodes/newContext.ts, electron/services/SessionService.ts]
createdAt: 2025-12-02T23:30:20.708Z
updatedAt: 2026-01-03T06:23:40.068Z
---

---
id: 7305761e-7555-41ed-8731-c157bca72770
title: Message history architecture and persistence
tags: [architecture, messages, messageHistory, llm, context, multi-modal]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/context-api.ts, electron/flow-engine/nodes/defaultContextStart.ts, electron/flow-engine/nodes/newContext.ts, electron/services/SessionService.ts, electron/flow-engine/types.ts]
createdAt: 2025-12-02T23:30:20.708Z
updatedAt: 2025-12-02T23:30:20.708Z
---

# Message history architecture and persistence

## Overview

Message history tracks the ordered list of user/assistant messages associated with a session or flow execution. It is used to build prompts for LLM requests and to render the context inspector in the UI.

## Data Structure

The `MessageHistoryItem` (defined in `electron/flow-engine/types.ts`) supports multi-modal content:

```typescript
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: string }

export interface MessageHistoryItem {
  role: 'system' | 'user' | 'assistant'
  content: string | MessagePart[]
  reasoning?: string
  metadata?: {
    id: string
    pinned?: boolean
    priority?: number
  }
}
```

## Key responsibilities
- Persist message history across turns in a session.
- Ensure correct isolation between independent contexts.
- Provide sanitized, model-ready message lists for LLM providers.
- **Multi-modal Handling**: Handle conversion between `string | MessagePart[]` and model-specific formats (OpenAI, Anthropic, Gemini).

## Primary components
- `electron/flow-engine/llm/payloads.ts`
  - contains `normalizeContentToText` utility to convert complex content back to plain text when needed (e.g. for RAG or logging).
  - Handles provider-specific message formatting (stripping images for older models, etc).
- `electron/flow-engine/llm-service.ts`
  - Reads `context.messageHistory` and converts it into provider-specific chat formats.
- `electron/flow-engine/nodes/defaultContextStart.ts`
  - Sanitizes message history (removes trailing blank messages, ensures user/assistant pairs).
- `electron/services/SessionService.ts`
  - Primary persistence layer for message history in the application state.

## Implementation details
- **Text Normalization**: When a string is required (e.g., for `retrieveWorkspaceMemoriesForQuery`), use `normalizeContentToText` from `payloads.ts`.
- **Validation**: `defaultContextStart` uses an `isBlank` helper that accounts for both string and `MessagePart[]` content.

## Design constraints
- `messageHistory` must always be an **array of MessageHistoryItem** objects.
- LLM-specific transformations (like adding `<think>` tags for reasoning) occur at the service boundary.
- Merging context updates is generally append-only.
