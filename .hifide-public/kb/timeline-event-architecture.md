---
id: c0faf7ed-abae-4a14-a594-df69e70b1d32
title: Timeline Event Architecture
tags: [architecture, timeline, events, usage]
files: [electron/flow-engine/timeline-event-handler.ts, electron/flow-engine/session-timeline-writer.ts, src/store/chatTimeline.ts]
createdAt: 2025-12-04T13:12:26.825Z
updatedAt: 2025-12-04T13:12:26.825Z
---

# Timeline Event Architecture

The Timeline Event Handler (`TimelineEventHandler`) is the bridge between the backend execution engine and the frontend session timeline. It listens to flow events and persists them to the session, which then broadcasts updates to the renderer.

## Core Responsibilities

1.  **Buffering:** Buffers streaming text and reasoning to avoid flooding the session writer.
2.  **Box Management:** Creates and updates "node execution boxes" in the timeline.
3.  **Tool/Badge Tracking:** Manages tool call states (running, success, error) and converts them into badges.
4.  **Token Usage:** Aggregates token usage and costs.

## Event Flow

1.  `flowEvents` emits an event (e.g., `nodeStart`, `chunk`, `usage_breakdown`).
2.  `TimelineEventHandler` receives the event.
3.  It determines the target "box" using `nodeId` and `executionId`.
4.  It updates the `SessionTimelineWriter` (which persists to disk/DB).
5.  `SessionTimelineWriter` broadcasts a delta (`session.timeline.delta`) to the frontend.
6.  The frontend `chatTimeline` store receives the delta and updates the React state.

## ID Recovery & Usage Badges

Some events, particularly `usage_breakdown` emitted by `LLMService`, might lack a valid `nodeId` or `executionId` if the context was lost or not strictly tracked during the async operation.

To ensure usage badges still appear:

1.  **Bypass Guard:** The handler allows `usage_breakdown` events to proceed even if `nodeId` is null (unlike other events which are dropped).
2.  **Open Box Lookup:** It checks `buffers.openBoxIds` to find *any* active node execution that matches the `nodeId` (if partial) or *any* active execution at all (as a last resort).
3.  **Attachment:** It attaches the usage badge to that recovered box ID.

## Key Files

- `electron/flow-engine/timeline-event-handler.ts`: Main listener logic.
- `electron/flow-engine/session-timeline-writer.ts`: Persistence and broadcast.
- `src/store/chatTimeline.ts`: Frontend store receiving deltas.
