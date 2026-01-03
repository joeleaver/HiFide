---
id: 9bd81d4e-4a5d-4e25-924f-83cce15aed31
title: Settings UI Implementation & Troubleshooting
tags: [ui, settings, bugfix, refactor]
files: [src/SettingsPane.tsx, electron/services/ProviderService.ts, src/components/ApiKeysSection.tsx]
createdAt: 2026-01-03T18:36:43.243Z
updatedAt: 2026-01-03T18:36:43.243Z
---

## Settings UI Redesign & Regression Fixes

### Two-Column Layout
The Settings UI has been moved to a two-column sidebar-and-content layout.
- **Sidebar**: Uses Mantine `NavLink` with `component="div"` to satisfy React nesting rules.
- **Tabs**: `api-keys`, `models`, `agent`, `pricing`.

### API Key Validation Flow
A regression occurred where saving API keys didn't update the associated model lists or validation checkmarks because the UI didn't trigger a full state refresh.
- **Fix**: The `onSaveComplete` handler in `SettingsPane.tsx` now calls a full `refresh()` on the snapshot. This forces the frontend to sync with the backend's updated `providerValid` and `modelsByProvider` state immediately after keys are saved.

### Duplicate ProviderService bug
A duplicate (and broken) `getModelsForProvider` method was discovered in `ProviderService.ts` that was overwriting the correct implementation and causing side-effects (setting global `selectedModel`) whenever models were requested.
- **Fix**: Removed the duplicate method. The correct `getModelsForProvider` now simply returns the filtered model list from state without modifying other selectors.

### Mantine & React Nesting (validateDOMNesting)
Generic `<div>` and `<a>` (default NavLink) tags inside Mantine layout components (Stack, Text) often trigger React warnings.
- **Fix**: Use Mantine `<Box>` instead of `<div>` and `<NavLink component="div">` to ensure proper DOM validaton.