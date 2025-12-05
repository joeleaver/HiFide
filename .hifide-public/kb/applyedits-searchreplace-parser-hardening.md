---
id: 5142b929-41b4-4f6d-8b02-b199e889a0c6
title: applyEdits search/replace parser hardening
tags: [applyEdits, tooling, parser]
files: [electron/tools/edits/applySmartEngine.ts, electron/__tests__/tools/applyEdits.searchReplace.test.ts]
createdAt: 2025-12-04T21:54:21.394Z
updatedAt: 2025-12-04T21:59:30.197Z
---

## Context
- `electron/tools/edits/applySmartEngine.ts` parses Search/Replace payloads emitted by `applyEdits`.
- When a `<<<<<<< SEARCH` block is missing its `=======` or `>>>>>>> REPLACE` terminators, the old parser would consume the rest of the payload as part of the replacement text. This allowed literal patch delimiters or metadata to be written into target files.

## Implementation
- `parseSearchReplace` now returns `{ blocks, errors }`, where `errors` surface structural issues (missing separators, unterminated blocks, etc.) along with the originating file hint and line number.
- The Search/Replace flow bails out with `malformed-search-replace` as soon as parsing errors exist, so no edits are applied when delimiters are imbalanced.
- Regression coverage lives in `electron/__tests__/tools/applyEdits.searchReplace.test.ts`, which verifies both the happy path and the malformed-payload guard to ensure patch markers can’t leak into source files.

## Notes
- Keep delimiter detection strict (must start at beginning of line, uppercase keywords) so we don’t silently guess.
- Tests create a temporary workspace and call `applyEditsPayload` with an explicit `workspaceId` to avoid mutating the real repo during validation.
