---
id: 2aa0109e-db57-4815-a184-3c1787f775c0
title: Badge System Architecture
tags: [architecture, badge, UI, usage-badge]
files: [electron/flow-engine/timeline-event-handler.ts, electron/flow-engine/llm-service.ts, src/components/session/Badge/ToolBadgeContainer.tsx]
createdAt: 2025-12-01T15:55:52.614Z
updatedAt: 2025-12-02T20:21:14.119Z
---

# Badge System Architecture

## Overview
Badges are visual elements in the session timeline representing discrete events or states, such as Tool Executions (e.g., `fs.read_file`) or System Events (e.g., `Usage Breakdown`).

## Current Implementation (Server-Side Logic)
Currently, the **Main Process** is responsible for constructing the full badge object, including UI-specific properties (labels, content types).

### Data Flow
1. **Event Emission**:
   - `LLMService` or `Scheduler` emits raw events (e.g., `toolStart`, `usage_breakdown`).
   - *Example*: `LLMService.chat` emits `usage_breakdown` via `flowAPI.emitExecutionEvent`.

2. **Event Handling (Main Process)**:
   - `TimelineEventHandler` (`electron/flow-engine/timeline-event-handler.ts`) listens for these events.
   - It **constructs the Badge Object**:
     - Derives `label` (e.g., formats `fs_read_file` to `FS Read File`).
     - Sets `contentType` (e.g., `usage-breakdown`).
     - Sets `status` (`running`, `complete`).
     - Adds `interactive` data if needed.

3. **Persistence & Broadcast**:
   - `TimelineEventHandler` calls `SessionTimelineWriter.write`.
   - The badge is saved to the session JSON.
   - A `session.timeline.delta` event is broadcast to the frontend.

4. **Rendering (Frontend)**:
   - The frontend receives the fully formed badge object.
   - `ToolBadgeContainer` renders it based on the `contentType`.

### Usage Badge Specifics
The "Usage Badge" displays token consumption and cost.
- **Trigger**: End of LLM execution.
- **Event**: `usage_breakdown` (contains `inputTokens`, `outputTokens`, `cost`, etc.).
- **Handler**: `TimelineEventHandler` creates a badge with `contentType: 'usage-breakdown'`.
- **Troubleshooting**: If usage badges are missing or events have null IDs:
  - Ensure `flowAPI` is correctly passed to `LLMService.chat`.
  - Ensure `LLMService` accesses `flowAPI.nodeId` and `flowAPI.executionId` directly (not via `flowAPI.context`, which is a separate API helper).

---

## Architecture Refactor Proposal (Client-Side Logic)
*Status: Proposed / Long-term Goal*

The current architecture mixes UI logic (badge formatting) into the Main Process.

### Proposed Flow
1. **Main Process**: Emits **Raw Events** only (e.g., `{ type: 'toolStart', tool: 'fs.read_file', ... }`).
2. **Renderer**: `FlowEventProcessor` receives raw events.
3. **Renderer**: Handles all formatting (`fs.read_file` -> "FS Read File"), styling, and badge construction.

### Benefits
- **Separation of Concerns**: Main process handles business logic; Renderer handles UI.
- **Flexibility**: UI changes don't require backend updates.
