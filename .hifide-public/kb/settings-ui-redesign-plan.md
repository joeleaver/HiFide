---
id: 763b1331-5595-498a-b220-7c2146d78d99
title: Settings UI Redesign Plan
tags: [ui, settings, redesign]
files: [src/SettingsPane.tsx]
createdAt: 2026-01-03T18:29:12.591Z
updatedAt: 2026-01-03T18:29:42.271Z
---

## Settings UI Redesign (Two-Column Layout)

The Settings UI has been refactored from a single-column stack into a professional two-column layout.

### Layout Details
- **Sidebar**: A 240px navigation bar on the left containing categories:
  - **API Keys**: Manage provider keys (OpenAI, Anthropic, Gemini, Fireworks, xAI, OpenRouter) and custom model allowlists for Fireworks/OpenRouter.
  - **Default Models**: Select the default model for each configured provider.
  - **Agent Behavior**: General configurations for agent execution (e.g., auto-retry).
  - **Cost & Pricing**: Detailed model pricing configuration for cost estimation.
- **Content Area**: A scrollable main area with a maximum width of 900px to maintain readability.

### Technical Implementation
- **State**: Uses `activeTab` local state in `SettingsPane.tsx` to switch sections.
- **Icons**: Integrated `@tabler/icons-react` for enhanced visual navigation.
- **Components**: Mantine `NavLink`, `Box`, `ScrollArea`, and `Group` were used to build the responsive layout.

### Files Involved
- `src/SettingsPane.tsx`: Main structural changes.
- `src/components/ApiKeysSection.tsx`: Integrated seamlessly into the new layout.
- `src/components/PricingSettings.tsx`: Integrated seamlessly into the new layout.

### Verification
- Manual verification of tab switching and RPC persistence (Saving keys, updating defaults).
- Layout responsiveness checked in the renderer.