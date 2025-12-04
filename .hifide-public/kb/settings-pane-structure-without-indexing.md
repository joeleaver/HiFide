---
id: 5dd8c4d4-f1b3-4a2a-888f-1389639e1b66
title: Settings pane structure without indexing
tags: [ui, settings, renderer]
files: [src/SettingsPane.tsx]
createdAt: 2025-12-04T00:06:30.715Z
updatedAt: 2025-12-04T00:06:30.715Z
---

The renderer’s `SettingsPane` component (`src/SettingsPane.tsx`) now shows only four sections:

1. **API Keys & Fireworks allowlist** – wraps `ApiKeysForm`, Fireworks allowlist controls, and the Save & Validate action via `useApiKeyManagement`.
2. **Default Models** – provider-specific `<Select>` controls that call `provider.setDefaultModel` RPCs.
3. **Agent Behavior** – currently only the auto-retry toggle wired to `provider.setAutoRetry`.
4. **Cost Estimation** – embeds `<PricingSettings>` for per-model pricing.

All indexing-related state (idx.status, idx.autoRefresh, search testing, rebuild buttons, etc.) was removed so the Settings screen no longer references deprecated `idx.*` RPCs. Future settings work should follow the existing Mantine `Stack`/`Divider` layout and keep new sections self-contained for easy removal when features are retired.