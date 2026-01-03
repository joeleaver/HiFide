---
id: edd807d2-22c8-4a89-9969-9caee1475b2e
title: Gemini Provider Rewrite & Multi-modal Analysis
tags: [gemini, multi-modal, ai-sdk, bugfix, images, pdf, multiple-files]
files: [electron/providers-ai-sdk/gemini.ts]
createdAt: 2026-01-03T05:12:13.795Z
updatedAt: 2026-01-03T05:42:03.946Z
---

# Gemini Provider Rewrite & Multi-modal Analysis

## Goal
Rewrite the Gemini provider from `ai-sdk` to the native Google SDK to evaluate advantages.

## Findings
- **AI SDK Advantages**: Handles agentic loops (multi-step tool calls), schema conversion, and provides unified streaming events.
- **Native SDK Advantages**: Earlier access to experimental features, direct media/file API support, and context caching management.
- **Conclusion**: Rewriting to native is NOT recommended unless specific features like Media/File API or Context Caching are strictly required. The AI SDK handles the complex agent loop automatically.

## Bug Diagnosis: Multi-modal Hallucinations
The model was hallucinating because image data was being stripped or incorrectly formatted before reaching the AI SDK.
- **Root Cause 1 (Duplicate Messages)**: `resumeFlow` added the original input to history, but the node returned input + context. `llmService` saw them as different and added a second turn. `formatMessagesForGemini` then stripped images from the "previous" (original) turn.
- **Root Cause 2 (Empty Context)**: A `null` context was being stringified as `"null"`, creating an ugly footer that distracted the model.
- **Root Cause 3 (API Mapping)**: While images *can* be sent as `file` types, using `type: 'image'` is the standard for visual processing in AI SDK.

## Fixes Applied
- **Pipeline Fix**: `resumeFlow` now appends context *before* adding the message to the session timeline, ensuring `llmService` deduplicates correctly and no images are stripped from the "current" turn.
- **Context Pruning**: Empty or null contexts are no longer appended to the message.
- **Multi-modal Mapping**: Gemini adapter now uses `type: 'image'` for image mimetypes and `type: 'file'` for others (PDF, etc.), conforming to AI SDK best practices for the Google provider.

## Multi-file Support
- **Confirmed**: Gemini 1.5 Pro/Flash, Claude 3.5, and GPT-4o all support multiple files/images in a single turn.
- **Implementation**: Both our UI and backend correctly preserve and transmit multiple parts in the message content array.
