---
id: bdb62bf9-682f-42d4-93bc-12b21f362aaf
title: Language Server Provisioning Strategy
tags: [lsp, typescript, vtsls, language-server, architecture, windows]
files: [electron/config/languageServers.ts, electron/services/LanguageServerService.ts]
createdAt: 2025-12-09T16:36:14.791Z
updatedAt: 2026-01-06T07:04:59.666Z
---

# Language Server Provisioning Strategy

## Core Principles

1.  **Zero Global Dependencies:** The system must not rely on globally installed tools (like `npm` or `python`) being in the PATH unless absolutely necessary (e.g. for creating the environment itself). All servers should be self-contained or provisionable within the app's scope.
2.  **Mason Registry as Truth:** We use the [Mason registry](https://github.com/mason-org/mason-registry) as the single source of truth for package versions, download URLs, and checksums. This ensures we aren't hardcoding URLs or versions.
3.  **Fallback to NPM/NPX:** Where a standalone binary isn't available (e.g., `tsserver` which is JS-only), we fallback to using `npm` / `npx` to run the server.

## Supported Language Servers

### TypeScript / JavaScript (`tsserver`)
- **Package:** `@vtsls/language-server` (wrapper around standard tsserver)
- **Provisioning:**
    1.  **Check Workspace:** Look for `typescript` in the workspace `node_modules` first. This ensures we match the project's version.
    2.  **Built-in Fallback:** Use the app's bundled `typescript` version if the workspace doesn't have one.
- **Initialization Options:**
    - `typescript.tsserver.useSyntaxServer: 'never'`: **CRITICAL**. This forces the full semantic server to run immediately. Without this, tsserver starts in a lightweight "syntax only" mode (no type checking, no project loading) until a semantic request is made. However, we want full project validation immediately.
    - `vtsls.autoUseWorkspaceTsdk: true`: Tells the wrapper to try and find the workspace TS version.
- **Path Normalization (Windows):**
    - **Issue:** Windows file systems are case-insensitive, but `tsserver` checks precise string equality between the project root path it inferred (or was told) and the paths in `tsconfig.json`. If `drive letters` differ in case (e.g. `c:\project` vs `C:\project`), `tsserver` might fail to load `tsconfig.json`, resulting in "invalid jsx" errors or missing type info.
    - **Solution:** We use `fs.realpathSync(workspaceRoot)` effectively to resolve the "canonical" casing of the path from the OS before initializing the language server. This ensures the `rootUri` and `rootPath` passed to the server match exactly what the OS expects and what `tsconfig.json` resolution will produce.

### Python (`pyright`)
- **Package:** `pyright` (via Mason or NPM)
- **Provisioning:**
    - Try Mason download (if standalone executable exists for platform).
    - Fallback to `npx pyright-langserver --stdio`.

### Other Languages
- **YAML**: `yaml-language-server` via `npx`.
- **JSON**: `vscode-json-languageserver` (often bundled or via `npx`).

## Configuration Structure

The configuration passed to `initialize` is critical. For `vtsls` specifically:

```typescript
initializationOptions: {
  // Option 1: Dotted keys (supported by vtsls for specific root overrides)
  "vtsls.autoUseWorkspaceTsdk": true,

  // Option 2: Nested objects (Preferred for standard settings)
  typescript: {
    tsserver: {
      log: "verbose",
      useSyntaxServer: "never" // Essential for full mode
    },
    tsdk: "path/to/lib" // If resolved manually
  }
}
```

Mixing dotted keys and nested objects is supported but care must be taken to ensure they don't conflict. We prefer nested objects for standard TypeScript settings.
