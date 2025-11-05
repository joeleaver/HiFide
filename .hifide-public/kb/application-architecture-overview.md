---
id: fafc3ebd-616d-481d-9313-bea463d66e99
title: Application architecture overview
tags: [architecture, electron, react]
files: [electron/main.ts, electron/core/app.ts, electron/store/index.ts, src/main.tsx, src/App.tsx, src/store/index.ts]
createdAt: 2025-11-03T21:27:50.915Z
updatedAt: 2025-11-03T21:27:50.915Z
---

## Main process
- `electron/main.ts` bootstraps environment variables, registers provider adapters (Anthropic, Gemini, OpenAI), exposes the aggregated agent tool registry, and initializes the application window + IPC handlers.
- Global error handling swallows benign PTY pipe errors, reports child-process exits, and logs unhandled rejections for diagnostics.
- `initializeApp` (electron/core/app.ts) wires standard Electron lifecycle events: creates the BrowserWindow on `app.whenReady`, handles macOS activation, and quits on `window-all-closed` for non-macOS platforms.
- Main process state lives in a persisted Zustand store (`electron/store/index.ts`) composed from feature slices (view, workspace, sessions, indexing, tools, etc.). Renderer actions dispatch via IPC and the main store broadcasts updates back.

## Renderer process
- `src/main.tsx` mounts the React renderer with Mantine UI, TanStack Query client, and shared styles.
- `src/App.tsx` renders the desktop shell: custom title bar, ActivityBar navigation, view router (agent chat, explorer, source control, knowledge base, settings), and StatusBar. It synchronizes menu events via typed preload APIs and surfaces notifications for flow import/export actions.
- Renderer state is a zubridge-synced projection of the main store (`src/store/index.ts`), preserving selectors and dispatch semantics while delegating side-effects to the main process.

## Cross-cutting details
- Agent session cleanup, AST tooling checks, and store initialization run post-window creation to keep first paint responsive.
- Terminal support is managed from the main store but decorated in renderer-only slices/components; PTY lifecycles live under `electron/ipc/pty.ts`.
- Knowledge base functionality is integrated as a dedicated store slice and renderer view, enabling future in-app surfacing of documentation.