---
id: 1c364d5a-2262-4ac6-8537-8cefcb2b034d
title: applyEdits invisible-character normalization
tags: [applyEdits, tooling, tests]
files: [electron/tools/edits/applySmartEngine.ts, electron/__tests__/tools/applyEdits.openAiPatch.test.ts, electron/__tests__/tools/applyEdits.searchReplace.test.ts]
createdAt: 2025-12-04T23:58:40.307Z
updatedAt: 2025-12-04T23:58:40.307Z
---

- Tooling: `electron/tools/edits/applySmartEngine.ts`
- Added `normalizeForLooseMatch` helper plus `ZERO_WIDTH_CHARS` set to scrub non-breaking spaces (U+00A0) and zero-width characters (U+200B/C/D, U+FEFF) before fuzzy matching.
- `findReplaceOnce` now falls back to matching against the normalized haystack/needle and maps the match back to original indices so OpenAI patch and search/replace payloads that accidentally introduce invisible characters still succeed.
- Regression coverage: `electron/__tests__/tools/applyEdits.openAiPatch.test.ts` and `electron/__tests__/tools/applyEdits.searchReplace.test.ts` now include "Line 2" scenarios with NBSP/zero-width characters for both OpenAI Patch and Search/Replace formats.
- Running `pnpm exec jest electron/__tests__/tools/applyEdits.openAiPatch.test.ts electron/__tests__/tools/applyEdits.searchReplace.test.ts` and `pnpm exec tsc --noEmit --pretty false` validates the behavior.