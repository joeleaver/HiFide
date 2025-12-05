---
id: 08c3453e-a32d-4a80-bcb6-6b87c61cb32f
title: applyEdits tool description (Markdown)
tags: [applyEdits, tooling, docs]
files: [electron/tools/edits/apply.ts]
createdAt: 2025-12-05T00:17:50.755Z
updatedAt: 2025-12-05T00:17:50.755Z
---

- The `applyEdits` tool description now lives directly in `electron/tools/edits/apply.ts` as a Markdown-formatted document assembled with `[].join('
')`.
- The doc covers: Search/Replace block syntax, OpenAI Patch requirements (Begin/Update headers, @@ hunks, optional context/end markers), unified diff support, and the general usage rules (workspace-relative paths, plain-text payloads, no code fences, minimal edits, inspect `no-match` failures).
- The string literal intentionally uses actual newline characters (join with `'
'`) so the metadata renders with correct line endings when surfaced to the model.