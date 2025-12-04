---
id: c22ad3dc-5c2e-4cd7-a6c1-ca3f2fca4bab
title: Token Usage Architecture
tags: [architecture, tokens, usage, llm]
files: []
createdAt: 2025-12-04T13:02:31.382Z
updatedAt: 2025-12-04T13:02:31.382Z
---

# Token Usage & Cost Architecture

## Overview
Token usage tracking has been refactored to minimize frontend rerenders and ensure data consistency.

## Event Flow
1. **Providers**: Emit `tokenUsage` events (via `emitUsage` callbacks) during or after streaming.
2. **LLMService**:
   - Accumulates these deltas internally (`accumulatedUsage`).
   - **Does NOT** emit intermediate `usage` events to the scheduler (to prevent rerender storms).
   - Emits a single `usage_breakdown` event at the end of execution containing the full breakdown and totals.
3. **TimelineEventHandler**:
   - Listens for `usage_breakdown`.
   - Creates the "Usage Badge" in the session timeline.
   - Updates the session-wide token totals (`writer.updateUsage`) using the totals from `usage_breakdown`.

## Key Components
- **LLMService**: Responsible for accumulation and final `usage_breakdown` emission.
- **TimelineEventHandler**: Responsible for persisting usage data to the session and timeline.
- **SessionTimelineWriter**: Updates the underlying session store.

## Debugging
- `usage_breakdown` events should contain `nodeId` and `executionId`.
- If missing, `TimelineEventHandler` attempts to recover them by looking up active "open boxes" (populated via `nodeStart` events).
