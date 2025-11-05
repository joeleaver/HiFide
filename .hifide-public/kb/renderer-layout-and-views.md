---
id: 73a97927-97f6-4dfe-9a65-4a1ccb4bf62d
title: Renderer layout and views
tags: [react, ui, renderer]
files: [src/App.tsx, src/components/ActivityBar.tsx, src/components/AgentView.tsx, src/components/ExplorerView.tsx, src/components/SourceControlView.tsx, src/components/KnowledgeBaseView.tsx, src/SettingsPane.tsx, src/store/index.ts]
createdAt: 2025-11-03T21:29:39.127Z
updatedAt: 2025-11-03T21:29:39.127Z
---

## Shell & navigation
- `src/App.tsx` renders the framed desktop shell with a custom title bar, ActivityBar navigation, dynamic view routing, and StatusBar telemetry.
- Menu commands from the main process are bridged via typed preload APIs and routed through a global Zustand dispatch to switch views, open folders, and manage flow import/export.

## Primary views
- **AgentView (`src/components/AgentView.tsx`)** – Chat workspace featuring streaming markdown, tool badges, and agent debug panels.
- **ExplorerView** – File explorer with optional embedded terminal panel synchronized via `windowState.explorerTerminalPanel*` store fields.
- **SourceControlView** – Source control placeholder integrating with flow status indicators.
- **KnowledgeBaseView** – In-app documentation browser powered by the knowledge base slice.
- **SettingsPane (`src/SettingsPane.tsx`)** – Provider configuration, pricing, and agent/tool toggles displayed inside the settings view.

## Supporting components
- ActivityBar, StatusBar, TerminalPanel, FlowCanvasPanel, and assorted badge components provide modular UI for node flows, terminal streaming, and usage telemetry.
- Notifications (Mantine) display import/export outcomes; renderer store selectors in `src/store/index.ts` feed these surfaces.

## Performance hooks
- `useRerenderTrace` and `logStoreDiff` helpers (src/utils/perf) watch store churn during development; App registers profiling to flag renders exceeding 16ms.
