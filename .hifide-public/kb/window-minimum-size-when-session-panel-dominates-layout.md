---
id: a3e500bd-f827-4d6e-9a20-f53693f6eeeb
title: Window minimum size when session panel dominates layout
tags: [ui, layout, session-panel, window]
files: [src/constants/layout.ts, src/App.tsx, src/components/ActivityBar.tsx, src/components/GlobalSessionPanel.tsx, electron/backend/ws/handlers/ui-handlers.ts]
createdAt: 2025-12-11T22:21:05.676Z
updatedAt: 2025-12-11T22:21:05.676Z
---

When the main (right-hand) panel is collapsed via the Activity Bar, the session panel becomes the only sizable column besides the Activity Bar. Even though `sessionPanelWidth` is clamped to `MIN_SESSION_PANEL_WIDTH` in the UI store, users can still resize the Electron window narrower than the sum of the session panel minimum and the Activity Bar width, which visually clips the session panel below its intended 480px minimum.

To guarantee the UX requirement that the session panel presents the same minimum width regardless of whether the right-hand panel is visible, we need Electron to enforce a matching minimum content width. The renderer should:

1. Share the Activity Bar width via `ACTIVITY_BAR_WIDTH` exported from `src/constants/layout.ts` (used by both `ActivityBar` and `GlobalSessionPanel`).
2. Add a renderer-side effect (e.g., in `src/App.tsx`) that watches `mainCollapsed`. When collapsed, call the backend RPC `window.setMinimumSize` with `width = MIN_SESSION_PANEL_WIDTH + ACTIVITY_BAR_WIDTH` and a reasonable min height (300). When expanded, reset the minimum size back to the default window baseline (400x300).
3. Persist the new RPC in `electron/backend/ws/handlers/ui-handlers.ts`, mirroring the connection/window guards used by `window.setContentSize` and relaying to `BrowserWindow.setMinimumSize`.

This keeps the session panel from visually shrinking below 480px even after the main panel is collapsed, matching the UX spec described in Hifide issue reports.
