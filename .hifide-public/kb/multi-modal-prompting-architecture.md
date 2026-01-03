---
id: 0576a8e9-3556-4bb2-aaf0-4fb385ad5a41
title: Multi-modal Prompting Architecture
tags: [multi-modal, images, clipboard, frontend]
files: [src/components/SessionInput.tsx]
createdAt: 2026-01-03T04:08:13.749Z
updatedAt: 2026-01-03T21:46:06.871Z
---

# Multi-modal Prompting Architecture

This article documents the implementation of multi-modal capabilities in the session input, specifically focusing on image ingestion and processing.

## Image Ingestion Methods

1.  **Drag and Drop**: Users can drag images into the input container.
2.  **File Picker**: A "+" icon allows manual file selection.
3.  **Clipboard Paste**:
    *   **Files**: Direct file paste (e.g. from file explorer).
    *   **Image Data**: Paste of raw image data (e.g. from a screenshot tool or "Copy Image" in a browser). This is handled by iterating through `e.clipboardData.items` and using `getAsFile()`.

## Image Processing Pipeline

To ensure optimal performance and compatibility with LLM providers (Anthropic, OpenAI):

1.  **Resizing**: Images are constrained to a maximum of **1568px** (width or height). This balance preserves detail for OCR/reasoning while avoiding excessive token consumption or model timeouts.
2.  **Optimization**:
    *   All images are processed through a HTML5 Canvas.
    *   Output format is **image/jpeg**.
    *   Quality is set to **0.7**.
    *   This significantly reduces payload size (often by 80-90%) with negligible impact on AI performance.
3.  **State Management**: Optimized images are stored in `pendingImages` as Base64 strings before being sent in the `FlowService.resume` call.

## Implementation Details

*   **File**: `src/components/SessionInput.tsx`
*   **Key Logic**: `handleFiles` function manages the FileReader and Canvas optimization flow.
*   **Paste Handler**: `onPaste` checks both `e.clipboardData.files` (for file objects) and `e.clipboardData.items` (for raw data).