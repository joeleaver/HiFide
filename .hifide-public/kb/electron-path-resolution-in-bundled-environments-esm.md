---
id: a66c6105-8013-4bbd-966e-a5c157596c18
title: Electron Path Resolution in Bundled Environments (ESM)
tags: [electron, vite, esm, paths, build]
files: [electron/main.ts, electron/core/window.ts]
createdAt: 2026-01-06T20:24:51.501Z
updatedAt: 2026-01-06T20:24:51.501Z
---

# Electron Path Resolution in Bundled Environments (ESM)

When building Electron applications with Vite and ESM, the main process code may be bundled into chunks located in `dist-electron/chunks/`. This changes the relative pathing between the entry point and other assets like the preload script.

## Core Resolution Pattern

To robustly resolve paths in both development and production (bundled), use the following logic in your entry point (e.g., `electron/main.ts`):

```typescript
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))

// Detect if we are running from a bundled chunk
const isChunk = DIRNAME.includes(path.join('dist-electron', 'chunks')) || DIRNAME.endsWith('chunks')

// DIST_ELECTRON should always point to the root of the electron build directory
process.env.DIST_ELECTRON = isChunk ? path.join(DIRNAME, '..') : DIRNAME

// APP_ROOT should point to the project root (where dist/ and dist-electron/ live)
process.env.APP_ROOT = isChunk ? path.join(DIRNAME, '..', '..') : path.join(DIRNAME, '..')
```

## Preload Script Loading

When creating a `BrowserWindow`, ensure the `preload` path is calculated relative to `DIST_ELECTRON`:

```typescript
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(process.env.DIST_ELECTRON, 'preload.mjs'),
    // ...
  },
})
```

## Why this is necessary

1.  **Vite Bundling**: Vite's library mode (used for the main process) often splits code into chunks to optimize size or handle dynamic imports.
2.  **ESM `import.meta.url`**: In ESM, `__dirname` is not available. Using `import.meta.url` provides the absolute path to the current file, which varies depending on whether the file is the original source or a bundled chunk.
3.  **Consistency**: By setting `process.env.DIST_ELECTRON` correctly at the very start of the application, all subsequent modules can rely on a consistent base path for assets.
