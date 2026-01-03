---
id: 0576a8e9-3556-4bb2-aaf0-4fb385ad5a41
title: Multi-modal Prompting Architecture
tags: [multi-modal, llm-service, images, context-management]
files: [electron/flow-engine/llm/payloads.ts, electron/flow-engine/contextManager.ts, src/components/SessionInput.tsx, electron/store/types.ts]
createdAt: 2026-01-03T04:08:13.749Z
updatedAt: 2026-01-03T05:01:47.924Z
---

# Multi-modal Prompting Architecture

This article outlines the support for multi-modal (image) prompting within the application.

## Overview

The application supports sending images to LLM providers that have vision capabilities (OpenAI, Anthropic, Gemini).

## Architecture

### Frontend (Renderer)
- **Component:** `src/components/SessionInput.tsx` handles drag-and-drop and the file picker.
- **Processing:** Images are automatically resized using a Canvas to a maximum of **1568x1568px** and converted to compressed JPEG (`0.7` quality).
- **State:** The `chatTimeline` store supports `TimelineMessagePart[]`.

### Backend (Main Process)
- **Data Structure:** `ChatMessage` and `SessionMessage` support `string | MessagePart[]`.
- **Persistence:** Multi-modal content is serialized as base64 strings in the session JSON files (`.hifide-private/sessions/<id>.json`).

### LLM Service & Payloads
- **Context Management:** The `ContextManager` maintains the full history.
- **Payload Generation:** To prevent token limit issues, the `payloads.ts` generators (`formatMessagesForOpenAI`, `formatMessagesForAnthropic`, `formatMessagesForGemini`) only include image data for the **last user message** in the conversation. Previous images in the history are replaced with a `[Image]` text placeholder in the payload sent to the API.

## Data Formats

### MessagePart
```typescript
{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string }
```

### Constraints
- **Image Resizing:** Max 1568px in either dimension.
- **Compression:** JPEG at 0.7 quality.
- **Context Window:** Images are stripped from history, preserving only the most recent user prompt's images.
