---
id: e6a949d8-3656-444d-a977-8e24f6770328
title: Web fetch-to-Markdown tool design
tags: [agent-tools, web]
files: [electron/tools/web/fetchMarkdown.ts, electron/tools/index.ts, electron/__tests__/tools/webFetchMarkdown.test.ts]
createdAt: 2025-12-07T01:20:24.408Z
updatedAt: 2025-12-07T01:29:58.680Z
---

## Implementation
- Tool lives at `electron/tools/web/fetchMarkdown.ts` and is registered in `electron/tools/index.ts` under the name `webFetchMarkdown`.
- Parameters: `url` (required HTTP/HTTPS), optional `selector` (default `body`, max 200 chars), `timeoutMs` (clamped 1–60s), `userAgent`, and `stripSelectors` (merged with defaults).
- Uses Crawlee's `CheerioCrawler` (`maxRequestsPerCrawl = 1`, `requestHandlerTimeoutSecs` derived from timeout) to fetch the page, applies `preNavigationHooks` to set UA + `Accept`, and validates response content-type (`text/html` or `xml`).
- Cleans the DOM by cloning the resolved selector (fallback to `<body>`) and removing `['script','style','noscript','template','iframe','svg', ...user selectors]`. Turndown is configured for ATX headings, fenced code blocks, table preservation, and a custom `<pre>` rule so fenced code retains `data-lang` hints.
- Returned payload includes metadata (`requestedUrl`, `finalUrl`, `statusCode`, `title`, `selectorUsed`, `removedSelectors`, `markdown`, `markdownLength`, `fetchedAt`, normalized headers, `contentType`, `userAgentApplied`, `timing.elapsedMs`, optional `warning`). Errors are surfaced via `{ ok: false, error: 'webFetchMarkdown: ...' }`.
- `toModelResult` limits Markdown previews to 1,200 characters plus an ellipsis and exposes a `previewKey` for UI hydration.

## Testing
- Covered by `electron/__tests__/tools/webFetchMarkdown.test.ts`, which mocks Crawlee to provide deterministic CheerioDOM fixtures. Tests cover invalid protocol handling, happy-path Markdown conversion (with custom strip selectors and fenced code expectation), and `toModelResult` preview truncation metadata.