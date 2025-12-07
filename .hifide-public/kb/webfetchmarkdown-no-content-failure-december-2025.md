---
id: ab4fdb02-c629-4590-9688-b44d4dd951c7
title: webFetchMarkdown no-content failure - December 2025
tags: [tooling, webFetchMarkdown, incident]
files: []
createdAt: 2025-12-07T01:43:00.220Z
updatedAt: 2025-12-07T01:43:00.220Z
---

## Summary
Beginning 2025-12-07 02:00 UTC the `webFetchMarkdown` tool started returning `ok: false` with the message "No content was captured from the provided URL" for every tested endpoint (e.g., `https://ai-sdk.dev/...`, `https://example.com`, `https://httpbin.org/html`). This indicates a regression in the HTTP fetcher or post-processing pipeline.

## Reproduction Steps
1. Call `webFetchMarkdown({ "url": "https://example.com" })` (optional: provide `userAgent`, `selector`, or `timeoutMs`).
2. Observe the response payload contains `ok: false` and `error: "webFetchMarkdown: No content was captured from the provided URL"` despite the URL being publicly accessible.
3. Retrying with alternate URLs, user agents, HTTP vs HTTPS, and longer timeouts yields the same error.

## Impact
- External documentation cannot be imported into the workspace for analysis or summarization.
- Tasks that rely on remote specs (e.g., ai-sdk provider docs) are currently blocked unless alternative data sources are available.

## Workaround
- Use `terminalExec` with `Invoke-WebRequest`/`curl` when feasible to capture content manually, though large responses may require writing to a file.
- If remote access is entirely blocked, notify stakeholders that the task is blocked until the tool is restored.

## Next Steps
- Investigate recent changes to the web fetch pipeline or hosting environment.
- Consider adding enhanced error telemetry so the tool can distinguish between HTTP failures vs. DOM parsing issues.