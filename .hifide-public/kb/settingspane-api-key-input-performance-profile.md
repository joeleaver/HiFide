---
id: eb905dbc-aef5-4727-be95-c89331317cd6
title: SettingsPane API key input performance profile
tags: [settings, performance, api-keys]
files: [src/SettingsPane.tsx, src/components/PricingSettings.tsx, src/store/settingsPricingDraft.ts]
createdAt: 2025-12-07T03:10:49.001Z
updatedAt: 2025-12-07T03:10:49.001Z
---

Typing into the API key inputs in `src/SettingsPane.tsx` triggers the `handleApiKeysChange` callback, which calls `mergeSnapshot` from `useSettingsSnapshot`. `mergeSnapshot` replaces the entire `SettingsSnapshot` object even though only `settingsApiKeys` changes. Because `SettingsPane` renders heavy children (notably `src/components/PricingSettings.tsx`, which builds accordion sections and tables for every provider), each keystroke forces the whole pane, pricing accordion, and all zustand selectors inside `useSettingsPricingDraft` to re-render. That work—sorting model lists, creating table rows, recalculating dirty-provider badges, etc.—accounts for ~250 ms of CPU per keystroke even though no RPCs fire until `Save & Validate` is clicked. Improving performance will require memoizing the expensive sections or decoupling the API-key inputs from the snapshot-wide state updates.