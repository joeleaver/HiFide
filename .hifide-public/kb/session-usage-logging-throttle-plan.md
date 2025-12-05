---
id: 1759862e-4a82-48f7-9c9d-d25c5c04a9ad
title: Session usage logging throttle plan
tags: [sessionUi, logging, usage]
files: [src/store/sessionUi.ts]
createdAt: 2025-12-05T01:34:22.084Z
updatedAt: 2025-12-05T01:35:20.578Z
---

Renderer console spam from `session.usage.changed` events is handled inside `src/store/sessionUi.ts`.

Implementation details:
- Added helpers `shouldLogSessionUsageDebug`, `logSessionUsageDebug`, and `summarizeUsagePayload`.
- Debug logging now activates only when either `import.meta.env.VITE_SESSION_USAGE_DEBUG === '1'` or `window.__HF_SESSION_USAGE_DEBUG` is truthy; otherwise, the handler stays silent.
- When enabled, logs emit only summarized payload info (token totals, aggregate cost, request count) instead of the entire object, keeping traces concise.
- Errors still use `console.error` so failures remain observable regardless of the flag.

To investigate usage/cost issues, set `VITE_SESSION_USAGE_DEBUG=1` before running the renderer dev server or flip `window.__HF_SESSION_USAGE_DEBUG = true` in DevTools, then reproduce the session flow.