---
id: 8eb67761-facd-402e-a0f8-36e1b4245d67
title: ActivityBar MCP button placement
tags: [ui, mcp, renderer]
files: [src/components/ActivityBar.tsx]
createdAt: 2025-12-08T21:50:36.700Z
updatedAt: 2025-12-08T21:50:36.700Z
---

## Overview
The ActivityBar now shows the MCP configuration button in the utility section at the bottom of the bar (directly above Settings). This keeps the primary navigation items (Flow, Explorer, Kanban, Source Control, Knowledge Base) grouped at the top while reserving the lower stack for global utilities.

## Renderer implementation
- **File:** `src/components/ActivityBar.tsx`
- Introduces a dedicated `mcpButton` descriptor that mirrors the collapse/expand behaviour of other views.
- The top `buttons` array intentionally excludes the MCP entry. Instead, the component renders:
  1. Collapsible toggle (when expanded)
  2. Primary navigation buttons mapped from `buttons`
  3. A flex spacer
  4. The MCP button
  5. The Settings button

This structure guarantees the MCP control always appears directly above Settings regardless of how many top-level views are present.
