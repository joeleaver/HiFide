---
id: 89839223-827c-42c0-b979-0e13217c5ae5
title: Session panel width constraints
tags: [ui, layout, session-panel]
files: [src/store/ui.ts, src/components/ActivityBar.tsx, src/components/GlobalSessionPanel.tsx, src/App.tsx, src/store/utils/uiPersistence.ts]
createdAt: 2025-12-10T23:44:29.913Z
updatedAt: 2025-12-11T00:07:40.668Z
---

**Context**
The session panel width is persisted in `uiPersistence` and rehydrated through `useUiStore` (`src/store/ui.ts`). Multiple UI entry points clamp the stored value when loading the layout.

**Current integration points**
- `src/store/ui.ts`: Keeps `sessionPanelWidth` in store state, initializes from persisted layout, and exposes setter helpers (`setSessionPanelWidth`, `reloadUiStateForWorkspace`, etc.).
- `src/constants/layout.ts`: Defines `MIN_SESSION_PANEL_WIDTH` (480px) so renderer components can share a single source of truth.
- `src/components/ActivityBar.tsx`: Reads persisted layout payloads, clamps/normalizes session width before persisting, and resizes the OS window when collapsing the main pane.
- `src/components/GlobalSessionPanel.tsx`: Uses `useUiStore` to drive panel resizing and enforces the minimum width during drag interactions.
- `src/App.tsx`: During bootstrap, clamps the width found in layout payload before writing it to the UI store and before resizing the window while collapsed.

**Rule (2025-02-XX)**
The minimum supported `sessionPanelWidth` is **480px**. Any default/fallback values and all clamp logic must use `MIN_SESSION_PANEL_WIDTH` to prevent the panel from shrinking further. When introducing new layout persistence or panel interactions, use the same minimum to avoid visual regressions.

**Implementation checklist (Dec 2025)**
- Clamp all persisted/default widths through `clampSessionPanelWidth` in the UI store (initial load, setters, `reloadUiStateForWorkspace`).
- Derive layout restores in ActivityBar/App via the helper or the shared constant; never fall back to `300` or `240` directly.
- GlobalSessionPanel drag math and inline styles should reference the exported constant.
- When collapsing/expanding the main view, ensure the computed window size accounts for `MIN_SESSION_PANEL_WIDTH + ACTIVITY_BAR_WIDTH` so the session pane never renders smaller than 480px.
