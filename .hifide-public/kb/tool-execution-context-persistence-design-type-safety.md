---
id: ff5b4f77-bdba-42ed-87c7-312eb187b46f
title: Tool Execution Context Persistence Design & Type Safety
tags: [llm, tools, persistence, history, types, verification]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/llm/payloads.ts, electron/flow-engine/types.ts, electron/flow-engine/contextManager.ts, electron/store/types.ts, electron/services/SessionService.ts]
createdAt: 2026-01-03T06:56:04.388Z
updatedAt: 2026-01-03T07:21:00.133Z
---

## Tool Execution Context Persistence Design & Type Safety

This document outlines the architecture for persisting tool execution context and ensuring type safety across the flow engine and session management.

### Overview

To prevent loss of context when an LLM call crashes or is interrupted mid-stream, the flow engine implements incremental history persistence. Tool calls and results are committed to the session history as soon as they are completed, rather than waiting for the entire LLM request to finish.

### Core Components

1.  **LLMService (`electron/flow-engine/llm-service.ts`)**:
    *   Handles the agentic loop and manages incremental updates to the `ContextManager`.
    *   `onStep` callback: Triggered after each LLM step (text chunk + tool calls). It adds assistant messages and tool results to the context history.
    *   `chat` method: Returns partial text and reasoning even if an error occurs.

2.  **ContextManager (`electron/flow-engine/contextManager.ts`)**:
    *   Provides a standardized API for mutating the conversation history.
    *   Supports the `'tool'` role for storing tool results.

3.  **TimelineEventHandler (`electron/flow-engine/timeline-event-handler.ts`)**:
    *   Listens to flow execution events (`nodeStart`, `chunk`, `toolStart`, `toolEnd`, `error`, etc.).
    *   Buffers and flushes content to the `SessionTimelineWriter`.
    *   **Error Handling**: Now catches `error` events and writes them to the session timeline box, ensuring LLM crashes are visible to the user.

4.  **SessionTimelineWriter (`electron/flow-engine/session-timeline-writer.ts`)**:
    *   Responsible for the actual writing of items to the session's `items` array.
    *   Supports appending text, reasoning, badges (tool calls), and **errors** to node execution boxes.

### UI Integration

1.  **ChatTimeline Store (`src/store/chatTimeline.ts`)**:
    *   Maintains the frontend state of the session timeline.
    *   Supports `appendError` and handles `op: 'appendToBox'` with an `error` field in the delta.

2.  **SessionPane (`src/SessionPane.tsx`)**:
    *   Renders the timeline items.
    *   Renders error items within node execution boxes using a distinct red alert style.

### Type Safety & Role Standardization

*   The `Role` type is standardized to include `'system'`, `'user'`, `'assistant'`, and `'tool'`.
*   `MessageHistoryItem` includes `tool_calls` and `tool_call_id` to support tool context hydration.
*   All changes are verified with `pnpm exec tsc --noEmit --pretty false` to ensure code integrity.

### Verification Protocol

After modifying source files, always run the following command to verify the application:
```bash
pnpm exec tsc --noEmit --pretty false
```
This prevents common issues like mismatched `try/catch` blocks or type inconsistencies.
