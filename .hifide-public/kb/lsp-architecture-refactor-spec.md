---
id: 05adbf0c-f55c-489c-99f8-be0af5ac9776
title: LSP Architecture Refactor Spec
tags: [lsp, architecture, typescript, vtsls]
files: [electron/services/lsp/LspManager.ts, electron/services/lsp/LspClient.ts, electron/services/lsp/ProjectContext.ts, electron/services/lsp/Protocol.ts, electron/config/languageServers.ts]
createdAt: 2026-01-06T15:15:14.240Z
updatedAt: 2026-01-06T15:24:35.128Z
---

# LSP Architecture Refactor Spec

The Language Server Protocol (LSP) implementation provides IDE-grade features (Hover, Completion, Definition, etc.) by orchestrating multiple language servers.

## Core Components

- **`LspManager`**: Orchestrates multiple `LspClient` instances. It maps file extensions to language IDs and selects the appropriate server. It also handles the "Provisioning" of servers (e.g., using `npx` for global servers or `node` for built-in ones).
- **`LspClient`**: Manages the lifecycle of a single language server process. It handles JSON-RPC communication using `vscode-jsonrpc` and manages the initialization handshake.
- **`ProjectContext`**: Resolves workspace-specific binaries and environment variables. It ensures that the IDE uses the project's own version of tools (like `typescript` or `eslint`) when available.
- **`Protocol`**: Provides utilities for strict path normalization and URI conversion.

## TypeScript/JavaScript Support (vtsls)

We use `@vtsls/language-server` as the primary engine for TS/JS. 
- **TSDK Resolution**: The system automatically locates the `tsserver.js` in the project's `node_modules/typescript/lib`. This is critical for supporting project-specific TypeScript versions and plugins.
- **Configuration**: Advanced features like Inlay Hints and Suggestion behavior are configured via `workspace/didChangeConfiguration` after the server starts.
- **JSX/TSX**: Supported by mapping `.jsx` to `javascriptreact` and `.tsx` to `typescriptreact`.

## Path Normalization Rules

To avoid "false positive" errors (especially on Windows), all paths must be:
1. Resolved to absolute paths.
2. Drive letters must be lowercased (e.g., `c:\` not `C:\`).
3. Converted to URIs using `vscode-uri` to ensure standard encoding.

## Adding New Languages

1. Add the language to `SupportedLspLanguage` in `shared/lsp.ts`.
2. Add a definition to `LANGUAGE_SERVER_DEFINITIONS` in `electron/config/languageServers.ts`.
3. Update `LspManager.getClientForPath` to map the file extension.
