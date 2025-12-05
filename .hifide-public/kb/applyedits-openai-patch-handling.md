---
id: fa6dd6f4-bc90-464e-84b9-294e53b21571
title: applyEdits OpenAI patch handling
tags: [applyEdits, openai-patch, tooling]
files: [electron/tools/edits/applySmartEngine.ts, electron/__tests__/tools/applyEdits.openAiPatch.test.ts]
createdAt: 2025-12-04T23:33:11.567Z
updatedAt: 2025-12-04T23:33:11.567Z
---

* **Location:** `electron/tools/edits/applySmartEngine.ts` (parser/dispatcher) with regression tests in `electron/__tests__/tools/applyEdits.openAiPatch.test.ts`.
* **Supported formats:**
  * OpenAI patch blocks now detect any payload containing `*** Begin Patch` and at least one `*** Update|Add|New|Delete File:` header. The `*** End Patch` footer is optional.
  * Hunks may include context lines either prefixed with a space or unprefixed; both forms flush the current +/- group so multiple replacements inside a single hunk are handled correctly.
* **Parser behavior:**
  * Consecutive `+` and `-` lines form a replacement group; context/blank lines delimit groups.
  * Create/delete operations respect workspace denylist + `.gitignore` filter and write via `atomicWrite`.
* **Testing:** Added Jest coverage to ensure (1) minimal OpenAI patches without an end marker and (2) context-line variants both apply successfully.
* **Related tooling:** `looksOpenAiPatch` is intentionally lenient so LLMs can omit trailing markers without tripping format detection. Non-OpenAI payloads still fall back to unified diff or SEARCH/REPLACE parsing.