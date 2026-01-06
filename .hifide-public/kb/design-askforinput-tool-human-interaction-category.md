---
id: 951ecd8a-e466-4bf5-93ee-6cbce0869072
title: Design: askForInput Tool & Human Interaction Category
tags: [tools, human-interaction, refactoring]
files: [electron/tools/human/askForInput.ts, electron/flow-engine/flow-api.ts, electron/flow-engine/scheduler.ts]
createdAt: 2026-01-06T15:30:50.437Z
updatedAt: 2026-01-06T15:30:50.437Z
---

# Human Interaction: askForInput Tool

The `askForInput` tool allows the LLM to pause execution and request specific information from the user. This is useful for clarifying requirements, asking for missing information, or getting confirmation before proceeding with sensitive operations.

## Tool Definition

- **Name**: `askForInput`
- **Category**: `Human Interaction`
- **Parameters**:
    - `prompt` (string): The message to display to the user.

## Implementation Details

The tool leverages the existing `waitForUserInput` mechanism in the `FlowAPI`. When called:
1. It logs the prompt.
2. It calls `flow.waitForUserInput()`.
3. It returns the user's response to the LLM.

## State Management Refactoring

To support multiple sources of user input (the `userInput` node and the `askForInput` tool), the state management needs to be generalized:
- The `waitingforinput` event should include context about *what* is waiting (e.g., node ID or tool name).
- The `FlowScheduler` already handles `userInputResolvers` by `nodeId`. For tools, we might need to associate the resolver with the current execution or a synthetic ID if called outside a specific node's direct logic (though tools usually run within a node).

## UI Integration

The `GlobalSessionPanel` and related components should listen for `waitingforinput` and display the input prompt. If a `prompt` is provided in the event, it should be displayed above the input field.
