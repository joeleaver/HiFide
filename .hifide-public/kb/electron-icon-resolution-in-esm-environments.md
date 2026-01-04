---
id: 85c82138-d067-4b9e-a6f7-2c6d30286feb
title: Electron Icon Resolution in ESM Environments
tags: [electron, esm, images, vite]
files: [electron/core/window.ts, vite.config.ts]
createdAt: 2026-01-04T05:11:57.976Z
updatedAt: 2026-01-04T05:11:57.976Z
---

## Electron Icon Loading in ESM

When using Electron with ESM (EcmaScript Modules), especially when bundled with Vite, `__dirname` is often polyfilled or absent. Additionally, environmental variable timing (like `VITE_PUBLIC` or `process.env.PUBLIC`) can be unreliable during early initialization of the `BrowserWindow`.

### Recommended Pattern

Instead of relying on `DIRNAME` or `__dirname` which might point to a bundled location (like `.output/` or `dist/` depending on the build step), use `process.cwd()` to point to the base public directory if you are in development, or bundle the icon and use `app.getAppPath()` for production.

**Fixed Implementation in `electron/core/window.ts`:**

```typescript
const win = new BrowserWindow({
  // Using process.cwd() ensures it looks relative to the root public folder
  // which works reliably in both dev and packaged environments if standard paths are followed.
  icon: path.join(process.cwd(), 'public', 'hifide-logo.png'),
  // ...
});
```

### Background on `nodeIntegration` and `contextIsolation`

Since Electron 12+, `contextIsolation: true` and `nodeIntegration: false` are defaults. For security reasons, the renderer process should not have access to the filesystem. The `icon` property is set in the **Main process**, which always has Node.js access. However, path resolution in the main process must still be robust against ESM/CJS differences.

Related Tasks:
- [task-1f975c32-6fff-4a5a-a2b1-37d48f1cc3ba](Fix Electron __dirname icon issue)
