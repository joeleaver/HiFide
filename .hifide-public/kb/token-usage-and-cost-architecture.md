---
id: 867628ab-379b-4e90-9a31-46e4a49976e1
title: Token Usage and Cost Architecture
tags: [architecture, cost, usage, llm, ipc]
files: [electron/flow-engine/llm-service.ts, electron/flow-engine/session-timeline-writer.ts, electron/services/SettingsService.ts]
createdAt: 2025-12-04T12:19:06.967Z
updatedAt: 2025-12-04T12:19:06.967Z
---

# Token Usage and Cost Architecture

This document describes how token usage and costs are tracked, calculated, and displayed in the application.

## Overview

The system separates **Token Counting** (in the LLM execution layer) from **Cost Calculation & Persistence** (in the Session layer). This ensures a clean architecture where the `LLMService` remains focused on provider interactions, while the `SessionService` (via `SessionTimelineWriter`) handles business logic like pricing and accounting.

## Data Flow

1.  **Token Emission (`LLMService`)**
    *   As the LLM streams a response, `LLMService` tracks token usage (either estimated or reported by the provider).
    *   It calculates **deltas** (new tokens since last report).
    *   It emits `usage` events containing these deltas (and totals) through the `FlowAPI`.
    *   *Note:* `LLMService` does **not** calculate costs.
    *   At the end of generation, it emits a `usage_breakdown` event with detailed stats (input, output, cache, etc.) for the Timeline Badge.

2.  **Event Routing (`FlowScheduler`)**
    *   The `FlowScheduler` receives events from `FlowAPI`.
    *   It re-emits `usage` events as `tokenUsage` events (for IPC/Event Handlers).
    *   It re-emits `usage_breakdown` as `usageBreakdown` events.

3.  **Processing & Persistence (`TimelineEventHandler` & `SessionTimelineWriter`)**
    *   `TimelineEventHandler` listens to `tokenUsage` events and calls `SessionTimelineWriter.updateUsage(ev)`.
    *   `SessionTimelineWriter` is the **Source of Truth** for cost calculation.
        *   It checks if cost is missing.
        *   It invokes `SettingsService.calculateCost(provider, model, usage)` to determine the cost of the *delta*.
        *   It updates the Session's `tokenUsage` and `costs` accumulators.
        *   It persists the session to disk.
        *   It broadcasts `session.usage.changed` to all renderers.
    *   `TimelineEventHandler` also listens to `usage_breakdown` to create a visual **Badge** in the chat timeline, but this is purely for display and does not affect the cost accounting.

4.  **Frontend Consumption (`SessionUi`)**
    *   The renderer (`SessionUi` store) subscribes to `session.usage.changed`.
    *   It updates the "Tokens & Costs" panel with the latest totals.
    *   The Timeline component renders the Usage Badge using data stored in the timeline item (from `usage_breakdown`).

## Key Components

*   **`LLMService`**: Provider-agnostic token tracking. Emits `usage` (stream) and `usage_breakdown` (final).
*   **`SettingsService`**: Contains pricing models and `calculateCost` logic.
*   **`SessionTimelineWriter`**: Central point for accumulating usage and calculating costs.
*   **`SessionService`**: Manages session state persistence (mostly delegated to Writer for updates).

## Deprecated/Removed

*   `SessionService.recordTokenUsage`: Removed in favor of `SessionTimelineWriter.updateUsage`.
