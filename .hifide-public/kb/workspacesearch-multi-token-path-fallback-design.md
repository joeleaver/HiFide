---
id: 946c4cd8-d49e-42e2-ab8a-f271c1c8c2dc
title: workspaceSearch multi-token & path fallback design
tags: [workspace-search, tooling, search]
files: [electron/tools/workspace/searchWorkspace.ts, electron/tools/workspace/__tests__/searchWorkspace.test.ts]
createdAt: 2025-12-11T22:29:33.012Z
updatedAt: 2025-12-11T22:54:55.235Z
---

## Overview
`workspaceSearch` now executes a three-phase pipeline so LLMs always see something useful even when the original phrase fails to match file contents.

1. **Pattern search (legacy behavior).** Run a single ripgrep invocation using the provided pattern/regex. Any hit short-circuits the rest of the pipeline.
2. **File-path search (new).** When the pattern search returns zero hits, tokenize the query (same tokenizer as the content fallback) and probe file paths before touching file contents again.
   - Discover files via `discoverWorkspaceFiles`, respecting the caller’s include/exclude globs, default ignore list, `.gitignore`, and dotfiles.
   - Cap discovery to 20k files to keep latency bounded; set `meta.truncated` when the cap is hit and expose `meta.filesScanned`.
   - Require at least two distinct token hits for multi-token queries (one token when the query itself is a single token). This prevents very common words (e.g., “search”) from polluting results.
   - Score files by (a) unique token coverage, (b) filename hits, (c) total occurrences, and (d) path length, then emit up to `maxResults` entries. Each entry reports `lineNumber: 0` + `line: "[file path match]"` so callers can distinguish path-derived rows.
   - Responses include `meta.mode: 'path'` alongside the tokens that were used.
3. **Tokenized content fallback.** Only runs if both prior stages produced no matches *and* the query supplied at least two tokens. Behavior is unchanged: per-token literal/CI scans feed a ranking pass that prioritizes token coverage over raw frequency and exposes `meta.mode: 'tokenized'` + the participating tokens.

## Notes
- The summary string clearly calls out whether path or tokenized mode was used so the UI/debug logs can explain why results look different from pure ripgrep.
- Even when path search succeeds, tokenized content search is skipped to preserve the fastest signals for filename-driven lookups.
- Tests live in `electron/tools/workspace/__tests__/searchWorkspace.test.ts` covering pattern, tokenized, and path-only flows.
- The agent-facing tool description (in `searchWorkspaceTool`) explicitly mentions the ripgrep → path → tokenized pipeline so downstream LLMs know what metadata/modes to expect before they call the tool.
