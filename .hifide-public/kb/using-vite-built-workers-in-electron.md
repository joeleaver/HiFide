---
id: e119d9c4-b6a0-4f15-810d-af524a677a5a
title: Using Vite-built Workers in Electron
tags: [vite, electron, workers, typescript]
files: []
createdAt: 2026-01-04T17:53:58.933Z
updatedAt: 2026-01-04T17:53:58.933Z
---

# Using Vite-built Workers in Electron

When using `vite-plugin-electron`, worker files defined in `vite.config.ts` are built into the `dist-electron` directory (usually as `.mjs` or `.js` depending on config).

Instead of trying to run `.ts` worker source files directly using `ts-node` (which requires complex `execArgv` hacking and often fails with module resolution issues), you should reference the **built** worker files.

## Configuration

In `vite.config.ts`, ensure your workers are entry points:

```typescript
entry: {
  main: 'electron/main.ts',
  'my-worker': 'electron/workers/my-worker.ts'
}
```

## Instantiation

In your main process code, point to the built file:

```typescript
const workerPath = path.join(process.cwd(), 'dist-electron/workers/my-worker.mjs');
new Worker(workerPath);
```

This avoids the need for `ts-node/register` in the worker thread and ensures the worker runs the same compiled code as production.