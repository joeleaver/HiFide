---
id: 26301e3c-7144-4ae3-8da0-2effee58f168
title: webFetchMarkdown Testing Procedure
tags: [tooling, webFetchMarkdown, operations]
files: []
createdAt: 2025-12-07T01:39:32.987Z
updatedAt: 2025-12-07T01:39:32.987Z
---

## Overview
The `webFetchMarkdown` tool fetches an HTTP(S) resource and converts its DOM to Markdown via Turndown. It is useful for quickly inspecting external documentation inside the agent workspace.

## Usage Steps
1. Identify a simple, publicly accessible URL (e.g., `https://example.com`).
2. Run the tool specifying the URL: `webFetchMarkdown({ "url": "https://example.com" })`.
3. Inspect the response fields:
   - `statusCode` for HTTP status verification.
   - `title` and `markdownPreview` to confirm the conversion succeeded.
   - `markdownLength` to understand payload size.
4. Include the fetched markdown snippet or summary in the task notes.

## Notes
- Prefer lightweight pages without restrictive robots policies.
- `selector` can scope extraction when only part of the page is needed.
- The example request on 2025-12-07 returned HTTP 200 with the "Example Domain" content, proving the tool operational.
