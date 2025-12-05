---
id: 22ae3ff5-d26e-42fc-8eb8-12a5ef9a0440
title: applyEdits usage instructions
tags: [applyEdits, tooling, docs]
files: [electron/tools/edits/apply.ts]
createdAt: 2025-12-05T00:07:26.892Z
updatedAt: 2025-12-05T00:11:27.639Z
---

`electron/tools/edits/apply.ts` now documents the three accepted payload shapes for the `applyEdits` tool using a Markdown-formatted description block:

- **Search/Replace blocks** use the `File:` header plus `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` delimiters. Text inside the SEARCH block must match the file exactly and markers stay left-aligned.
- **OpenAI Patch sections** start with `*** Begin Patch` and `*** Update File`, include at least one `@@` hunk with `-`/`+` lines, and can optionally end with `*** End Patch`. Surround with context when multiple matches may exist.
- **Unified diff patches** (`--- a/...` / `+++ b/...`) follow standard git-style hunks and may include or omit `a/` and `b/` prefixes.

General guidance: provide the payload as plain text (no JSON or code fences), reference files relative to the workspace root, leave blank lines between consecutive blocks, and rely on the Markdown description for authoritative, line-by-line instructions. The tool continues to respect `.gitignore` plus internal denylisted paths and preserves indentation/BOM/EOL.
