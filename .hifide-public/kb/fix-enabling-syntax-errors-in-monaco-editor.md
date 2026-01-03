---
id: d080df61-0610-4ca9-8810-0e9999668226
title: Fix: Enabling Syntax Errors in Monaco Editor
tags: [editor, monaco, lsp, diagnostics, fix]
files: [src/lib/editor/monacoInstance.ts, src/lib/lsp/diagnostics.ts, src/store/lspDiagnostics.ts]
createdAt: 2026-01-03T04:04:07.658Z
updatedAt: 2026-01-03T04:04:07.658Z
---

## Problem
Users reported that syntax errors (diagnostics) were not being shown in the Monaco editor, even though language servers were active.

## Cause
The `src/lib/editor/monacoInstance.ts` file had `noSemanticValidation` and `noSyntaxValidation` set to `true` for both TypeScript and JavaScript defaults. This explicitly disabled Monaco's built-in validation, and in some versions of Monaco, setting these to true can interfere with external diagnostic markers being rendered if they are associated with the same language service.

## Solution
Updated `src/lib/editor/monacoInstance.ts` to set:
- `noSemanticValidation: false`
- `noSyntaxValidation: false`

This enables the editor to show diagnostics. Since we use external LSPs for many languages, this allows the diagnostics sent via `LSP_NOTIFICATION_DIAGNOSTICS` to be correctly visualized in the editor.

## Related Files
- `src/lib/editor/monacoInstance.ts`
- `src/lib/lsp/diagnostics.ts`
- `src/store/lspDiagnostics.ts`