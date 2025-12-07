---
id: 84619bff-2b3f-4287-a7d1-be64c7930385
title: SettingsPane API key merge logic
tags: [frontend, settings]
files: [src/SettingsPane.tsx]
createdAt: 2025-12-07T02:47:57.583Z
updatedAt: 2025-12-07T02:47:57.583Z
---

SettingsPane normalizes API key updates from `useApiKeyManagement`. When `ApiKeysForm` emits a `Record<string,string>`, `handleApiKeysChange` now merges those values with the existing `SettingsSnapshot.settingsApiKeys`, iterating over the known provider list (`openai`, `anthropic`, `gemini`, `fireworks`, `xai`). This keeps the object typed as `ApiKeys` so downstream Electron store code receives all provider-specific fields. See `src/SettingsPane.tsx` for the implementation.