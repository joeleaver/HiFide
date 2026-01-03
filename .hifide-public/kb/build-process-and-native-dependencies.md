---
id: fa546086-86de-4b4f-8178-d725fc3671f2
title: Build Process and Native Dependencies
tags: [build, electron-builder, node-pty, pnpm, windows]
files: [package.json, scripts/postinstall.cjs, scripts/afterPack-assert-pty.cjs]
createdAt: 2026-01-03T06:34:27.527Z
updatedAt: 2026-01-03T06:34:27.527Z
---

# Build Process and Native Dependencies

This project uses `electron-builder` to manage the build process and native dependencies (specifically `node-pty`).

## Native Dependency Rebuilding

We have removed `@electron/rebuild` (electron-rebuild) in favor of the built-in mechanism provided by `electron-builder`.

### postinstall script
The `postinstall` script in `package.json` runs `node scripts/postinstall.cjs`. This script ensures that native dependencies are rebuilt to match the local Electron version whenever `pnpm install` is run.

### why scripts/postinstall.cjs?
On Windows, `pnpm` sets `npm_execpath` to a `.cjs` file which `electron-builder` (or its underlying tools) cannot execute directly. The wrapper script fixes this by:
1. Detecting Windows.
2. Finding the `pnpm.cmd` wrapper using `where.exe`.
3. Overriding `npm_execpath` with the absolute path to `pnpm.cmd`.

## Packaging
In `package.json`, the `build` configuration has `"npmRebuild": true`. This ensures that `electron-builder` automatically rebuilds native dependencies for the target platform and architecture during the packaging process.

## Verification
The `scripts/afterPack-assert-pty.cjs` script runs after packaging to verify that the necessary PTY binaries (`conpty.node`, `pty.node`, etc.) are present in the `app.asar.unpacked` directory. This prevents shipping a broken application if the rebuild fails silently.
