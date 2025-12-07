---
id: 0fcfde7e-9995-4a40-89e9-5ba4dae4c52b
title: webFetchMarkdown ingestion strategy
tags: [web, tools, fetchMarkdown]
files: [electron/tools/web/fetchMarkdown.ts, electron/__tests__/tools/webFetchMarkdown.test.ts]
createdAt: 2025-12-07T01:56:12.104Z
updatedAt: 2025-12-07T02:25:27.975Z
---

## Overview
The `webFetchMarkdown` agent tool (see `electron/tools/web/fetchMarkdown.ts`) fetches arbitrary HTTP(S) pages, strips noisy selectors, and converts the scoped DOM subtree to Markdown via Turndown. It runs in three phases:

1. **Input sanitization** – validates the URL, clamps timeouts, deduplicates the caller-provided `stripSelectors`, and normalizes request headers (User-Agent + Accept).
2. **Fetch + DOM extraction** – primarily uses Crawlee’s `CheerioCrawler` so we inherit retries, robots.txt awareness, and a battle-tested HTML parser. The handler scopes to the requested selector (falling back to `body`), removes the selector blacklist, and builds Markdown once non-empty HTML remains.
3. **Result shaping** – packages request/response metadata, Markdown stats, and a `toModelResult` preview that truncates long bodies to 1.2k chars for token efficiency. The exported tool description now explicitly documents the optional search parameter so LLM planners understand how to request scoped results.

## Reliability plan
If Crawlee exits without invoking the handler (e.g., upstream library skips a request), we now fall back to a direct `fetch()` request + `cheerio.load` to guarantee "last resort" coverage for first-party docs like `https://ai-sdk.dev/providers/ai-sdk-providers/openai#image-inputs`. The fallback reuses the same selector/removal pipeline so downstream behavior stays identical.

Tests live in `electron/__tests__/tools/webFetchMarkdown.test.ts`. Unit tests keep mocking Crawlee, but we also gate a real HTTP integration test behind `TEST_MODE=live` to exercise the ai-sdk.dev page during manual or CI live runs without impacting the default suite.

## Search-scoped context mode
Large docs can overwhelm downstream models, so the tool accepts an optional `search` parameter (space/comma-delimited string up to 256 chars):

- The query is trimmed and tokenized into distinct lowercase keywords (tokens shorter than two characters are ignored). An empty token list yields a warning (`search: query "<value>" did not include usable keywords`).
- We always build the full Markdown first, storing its original length in `fullMarkdownLength` whenever a search query exists.
- A line-wise scan gathers up to six context windows containing any keyword. Each window now spans roughly fifty lines **before** and **after** every match (mirroring the tool description), merges overlapping ranges, and records `snippet`, `startLine`, `endLine`, and `matchedTerms` metadata. We also track the aggregate match count.
- When at least one window exists, the returned `markdown` is replaced by the concatenated snippets separated with blank-line/`---`/blank-line delimiters, `markdownLength` is updated, and `searchSummary.filtered` is set to `true`. Callers can rely on `searchSummary.contexts` for precise citations.
- If no matches are found we keep the full Markdown, set `searchSummary.filtered = false`, keep `fullMarkdownLength === markdownLength`, and append a `search: no matches found for "<query>"` warning so agents know to broaden their strategy.

The `toModelResult.minimal` preview surfaces `fullMarkdownLength` and the `searchSummary` blob so higher-level planners understand whether the output was filtered without expanding the full payload.