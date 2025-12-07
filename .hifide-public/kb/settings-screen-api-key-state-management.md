---
id: 1d62a8dd-520e-469e-9383-de50f845724a
title: Settings screen API key state management
tags: [frontend, settings, state-management]
files: []
createdAt: 2025-12-07T02:38:23.939Z
updatedAt: 2025-12-07T02:38:23.939Z
---

## Context
The Settings screen consumes the `useSettingsSnapshot` hook for the authoritative view of provider configuration (default models, validation state, etc.). Previous revisions kept a second copy of API key state inside `useApiKeyManagement`, synchronized through a `useEffect` in `SettingsPane`. That approach caused typed keys to be overwritten and violated the requirement to avoid effect-based synchronization on this screen.

## Current approach
- `SettingsPane` treats the snapshot’s `settingsApiKeys` and `providerValid` objects as the single source of truth.
- `useApiKeyManagement` was extended to accept optional controlled values (`apiKeys`, `providerValid`) and matching `onChange` callbacks. When these props are provided, the hook defers to them instead of managing its own copies.
- When running in controlled mode, hydration routines and validation responses flow back through the supplied callbacks so the snapshot remains current.
- Other screens (e.g., `WelcomeScreen`) can continue to use the hook in uncontrolled mode without changes.

## Files
- `src/SettingsPane.tsx`
- `src/hooks/useApiKeyManagement.ts`
