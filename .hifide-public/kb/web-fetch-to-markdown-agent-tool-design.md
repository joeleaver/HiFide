---
id: 346a22a2-7af7-46bf-b44a-fee95214492e
title: Web fetch-to-Markdown agent tool design
tags: [tools, web, llm]
files: [electron/tools/web/fetchUrlMarkdown.ts]
createdAt: 2025-12-07T01:00:43.847Z
updatedAt: 2025-12-07T01:00:43.847Z
---

## Purpose
Provide agent runtimes with a dedicated tool that can fetch arbitrary HTTP(S) URLs, extract the readable article content, convert it to Markdown, and return the cleaned text (plus metadata) for downstream reasoning.

## Planned implementation
- **Tool name:** `webFetchMarkdown` (exposed through `electron/tools/index.ts`).
- **Location:** new module `electron/tools/web/fetchUrlMarkdown.ts` with a helper for HTML→Markdown conversion (co-located for unit testing).
- **Dependencies:** `crawlee` (for `CheerioCrawler`), `turndown` (HTML→Markdown), `@mozilla/readability` + `jsdom` (reader-mode extraction), and `@types/turndown` for TypeScript support.
- **Parameters:**
  - `url` (string, required, must be HTTP/HTTPS) — target document.
  - `useReaderMode` (boolean, default `true`) — whether to run Mozilla Readability before Markdown conversion.
  - `maxMarkdownChars` (integer, default `60000`) — guards against oversized outputs; results should note if truncation happened.
  - `requestTimeoutMs` (integer, default `20000`) — passed to Crawlee for network timeout configuration.
- **Workflow:**
  1. Validate inputs (`new URL()`, scheme check, sane limits) and normalize.
  2. Instantiate a single-run `CheerioCrawler` with `maxRequestsPerCrawl = 1` and the configured timeout.
  3. When the handler fires, capture the final URL, status code, and raw HTML (`body`).
  4. Convert HTML to Markdown:
     - Build a `JSDOM` instance and run `Readability` when `useReaderMode` is enabled; fall back to raw HTML on failure.
     - Apply `TurndownService` with fenced code blocks, heading normalization, table + link retention, image alt text, etc.
     - Strip excessive whitespace, coerce Windows EOLs to `
`, and enforce `maxMarkdownChars` (track `truncated` flag).
  5. Return `{ ok, url, finalUrl, statusCode, contentType, markdown, truncated, meta }`.
  6. Provide a `toModelResult` implementation storing the full Markdown in the UI payload cache (preview key) while giving the LLM a short summary to conserve tokens.
- **Testing strategy:**
  - Unit-test the HTML→Markdown helper with synthetic HTML fixtures (table, pre/code, reader mode fallbacks) inside `electron/tools/web/__tests__` using Jest. Networking logic remains integration-tested manually because Crawlee requires live requests.

This document should be updated once the module lands to reference any helper files and concrete behavior details (e.g., badge metadata, error modes).