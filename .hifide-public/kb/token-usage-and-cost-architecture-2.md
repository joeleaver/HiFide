---
id: 8fd3b3ae-67c2-403c-be85-61aaaf79db4c
title: Token Usage and Cost Architecture
tags: [architecture, tokens, costs, billing, refactor]
files: []
createdAt: 2025-12-04T12:43:28.740Z
updatedAt: 2025-12-04T12:43:28.740Z
---

# Token Usage and Cost Architecture

This document outlines the architecture for tracking token usage and calculating costs in the flow engine.

## Core Flow
1.  **LLMService (Source of Truth for Tokens):**
    *   Interacts with providers (OpenAI, Anthropic, etc.).
    *   Tracks raw token usage (input, output, cached).
    *   Emits `usage` execution events (streaming deltas).
    *   Emits `usage_breakdown` execution events (final detailed stats).
    *   **Crucial:** LLMService does **NOT** calculate costs. It deals strictly in tokens.

2.  **FlowScheduler (Event Router):**
    *   Receives execution events from `LLMService`.
    *   Routes them to `flowEvents` emitter.

3.  **TimelineEventHandler (Persistence & Relay):**
    *   Listens to `tokenUsage` flow events.
    *   Delegates to `SessionTimelineWriter.updateUsage(ev)`.

4.  **SessionTimelineWriter (Cost Logic & Persistence):**
    *   **Centralized Cost Calculation:**
        *   Receives token usage deltas.
        *   Checks `ev.cost`. If missing (standard behavior), it calls `SettingsService.calculateCost(provider, model, usage)`.
        *   This ensures all cost logic lives in one place and respects user pricing overrides.
    *   **State Updates:**
        *   Updates `session.tokenUsage` (totals, by-provider).
        *   Updates `session.costs` (totals, by-provider-model).
        *   Appends to `session.requestsLog`.
    *   **Broadcast:**
        *   Sends `session.usage.changed` to the renderer.

5.  **SessionUi (Renderer Consumption):**
    *   Listens for `session.usage.changed`.
    *   Updates the `SessionUi` store.
    *   `TokensCostsPanel` renders the data.

## Key Invariants
*   **LLMService never imports SettingsService:** This prevents circular dependencies and separates concerns.
*   **Requests Log:** Must store the *calculated* cost, not the raw event cost (which is usually undefined).
*   **Cost Object:** Must be a full `TokenCost` object (input, output, total, currency), not just a number.

## Debugging
*   **Missing Costs:** Check if `SessionTimelineWriter` is receiving `ev.cost` as a number (bad) or undefined (good, triggers calculation).
*   **Empty ByProvider:** Check if `ev.provider` matches `PricingConfig` keys exactly (case-sensitive).
