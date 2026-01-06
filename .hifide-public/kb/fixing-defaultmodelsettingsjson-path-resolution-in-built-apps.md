---
id: aa7e5442-2959-4115-8fdd-04850ba137dc
title: Fixing defaultModelSettings.json Path Resolution in Built Apps
tags: [electron, build, windows, paths]
files: [electron/main.ts, electron/data/defaultModelSettings.ts]
createdAt: 2026-01-06T17:49:10.773Z
updatedAt: 2026-01-06T17:49:10.773Z
---

### Issue
In built Electron versions on Windows, the application failed to locate `defaultModelSettings.json`.

### Root Causes
1.  **APP_ROOT Calculation**: When the main process code is bundled into `dist-electron/chunks/`, the relative path calculation `path.join(DIRNAME, '..')` pointed to `dist-electron/` instead of the project root.
2.  **ASAR Pathing**: The fallback logic for `process.resourcesPath` did not account for the standard `app.asar/dist/` internal structure where `public/` assets are placed by Vite.

### Fixes
-   **`electron/main.ts`**: Updated `APP_ROOT` logic to detect if the module is running from a `chunks` directory and adjust the path depth accordingly.
-   **`electron/data/defaultModelSettings.ts`**: Added specific checks for `app.asar/dist/defaultModelSettings.json` when running in a packaged environment.

### Verification
-   Check logs for `[defaultModelSettings] loading from: ...` to ensure the correct path is resolved.
-   `VITE_PUBLIC` should point to `.../resources/app.asar/dist` in production.