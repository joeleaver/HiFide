---
id: 41abf349-3df0-4ee1-b45c-041de03c32e3
title: MDXEditor link and table support
tags: [editor, markdown, mdxeditor]
files: [src/lib/editor/markdownPluginRegistry.ts, src/lib/editor/markdownPlugins.ts, src/components/ExplorerView.tsx, src/components/KnowledgeBaseView.tsx, src/components/SessionInput.tsx]
createdAt: 2025-12-11T03:33:21.721Z
updatedAt: 2025-12-11T03:33:21.721Z
---

We need to restore proper link rendering and GitHub-style tables inside every MDXEditor instance. None of the editor configurations currently include the `linkPlugin`, `linkDialogPlugin`, or `tablePlugin`, so pasting or editing `[title](https://example.com)` produces runtime errors and markdown tables stay as plain text. The fix is to:

1. Extend `src/lib/editor/markdownPluginRegistry.ts` with deterministic keys for `table`, `links`, and `link-dialog`. Update the Jest snapshot and add corresponding builders in `src/lib/editor/markdownPlugins.ts` that register `tablePlugin()`, `linkPlugin()`, and `linkDialogPlugin()` (the dialog plugin needs to run after the link plugin).
2. Update all `MDXEditor` toolbars (`ExplorerView`, `KnowledgeBaseView`, and `SessionInput`) so link/table buttons are available where rich markdown editing is expected. Import `CreateLink` and `InsertTable` from `@mdxeditor/editor` and include them in the toolbar contents next to the existing formatting toggles.
3. Ensure every `plugins` array that previously omitted links/tables now includes the new plugin builders so tables render correctly and the link dialog works throughout the app.

This keeps markdown feature parity between Explorer markdown tabs, Knowledge Base editing, and the session input field.