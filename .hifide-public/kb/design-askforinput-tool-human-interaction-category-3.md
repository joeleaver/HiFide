---
id: 6f0b4d66-6489-4a3f-88e9-df651e5d293f
title: Design: askForInput Tool & Human Interaction Category
tags: [tools, human-interaction, architecture]
files: []
createdAt: 2026-01-06T15:39:26.910Z
updatedAt: 2026-01-06T16:24:56.970Z
---

# askForInput Tool & Human Interaction Category

## Overview
The `askForInput` tool allows an LLM to pause execution and request specific information or feedback from the user. It integrates with the existing session input field and provides a structured Q&A view in the chat timeline.

## Implementation Details

### Backend
- **Tool Definition**: `electron/tools/human/askForInput.ts`
- **Category**: `human` (Human Interaction)
- **Mechanism**: Calls `flowAPI.waitForUserInput(prompt)`, which emits a `waitingforinput` event and returns a promise that resolves when the user submits input.
- **Flow Engine**: `resumeFlow` in `electron/flow-engine/index.ts` now supports an `isToolResponse` option to prevent tool-call responses from being added as independent user messages in the session history.

### Frontend
- **State Management**: The `flowRuntime` store tracks `inputPrompt`. It clears the prompt and resets status to `running` on `toolend` or `toolerror`.
- **UI Components**:
    - `SessionControlsBar.tsx`: Displays the blue "PROMPT" card when the LLM is waiting.
    - `SessionInput.tsx`: Detects `waitingForInput` status and sends the `isToolResponse` flag when resuming.
    - `HumanInputViewer.tsx`: Displays the Q&A in the tool badge.

### Badge Configuration
- **Processor**: `electron/flow-engine/badge-processor.ts`
- **Title**: Shows the prompt text.
- **Content Type**: `human-input`
- **Viewer**: `src/components/session/Badge/viewers/HumanInputViewer.tsx`

## Usage for Agents
Agents should use this tool when they need:
1. Clarification on ambiguous instructions.
2. Approval for high-risk actions.
3. User-specific data that isn't available in the workspace.
4. Multimodal input (e.g., asking the user to provide a screenshot).