---
id: bdb62bf9-682f-42d4-93bc-12b21f362aaf
title: Language server provisioning strategy
tags: [editor, lsp, architecture]
files: [electron/services/LanguageServerService.ts, electron/config/languageServers.ts, shared/lsp.ts, electron/backend/ws/handlers/language-handlers.ts, electron/backend/ws/event-subscriptions.ts, src/store/languageSupport.ts, src/components/ExplorerView.tsx, src/lib/lsp/client.ts]
createdAt: 2025-12-09T16:36:14.791Z
updatedAt: 2025-12-09T17:02:17.882Z
---

## Summary
We now hydrate language support metadata directly from the Mason registry release (the `registry.json.zip` asset published on every tag). The backend downloads and unzips the registry with `fflate`, filters the packages we care about (typescript-language-server, pyright, yaml-language-server, …), and caches the parsed payload in memory for six hours. Each renderer language ID maps to a Mason package via `electron/config/languageServers.ts` so that the LSP service can resolve version pins, surface display names, and determine whether a language is auto-installable.

## Backend implementation
- `LanguageServerService` (electron/services/LanguageServerService.ts) now persists per-language preferences (auto-install toggle + enabled languages) and emits `lsp.languageStatus` notifications so the renderer always knows whether a language is disabled, pending, installing, ready, or in error.
- TypeScript/JavaScript remain “built-in” (we launch the vendored `typescript-language-server` directly), while other languages currently use an `npm-npx` strategy: we spawn `npx --yes <package>@<registry version> <bin> --stdio`, letting npm cache the download in the user profile so we do not manage installs manually yet.
- Registry refreshes happen lazily and reuse a shared fetch promise so multiple workspaces can trigger provisioning without stampeding the network. Version hints are cached per server key so status updates can display the resolved package version.
- Provisioning is now part of the LSP open/change path: if a file targets a language that is disabled, the backend either auto-enables it (when the global auto-install preference is true) or throws `language-disabled`, prompting the renderer to ask the user for consent.

## Renderer UX
- The renderer subscribes to `lsp.languageStatus` via the new `useLanguageSupportStore`, hydrates the initial snapshot by calling `lsp.languages`, and exposes helpers to request provisioning or toggle the auto-install preference.
- ExplorerView shows a VSCode-style alert above the editor whenever a tab uses a language that is disabled but auto-installable. Buttons let the user install just this language, opt into “always auto-install,” or dismiss the prompt. While installation runs we show a lightweight “Installing …” banner, and failure bubbles up as a red alert that exposes the backend error string.
- The store tracks dismissed prompts per session so we do not nag repeatedly, and it keeps the latest statuses in memory so multiple tabs stay synchronized with backend progress.

## Follow-ups
- Extend `languageServers.ts` with more Mason-backed languages (Go, Rust, etc.) once we verify the `npm-npx` approach or add dedicated installers for non-npm packages.
- Add the “Manage Language Servers” panel described in the original plan so users can see history/retry failed installs outside of the inline prompt.
