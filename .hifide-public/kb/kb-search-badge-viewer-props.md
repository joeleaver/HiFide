---
id: 08ced11d-6b09-45b5-a3a3-4675b6067186
title: KB search badge viewer props
tags: [workspaceSearch, knowledgeBase, badges, frontend]
files: [src/components/BadgeKnowledgeBaseSearchContent.tsx, src/components/session/Badge/viewers/KBSearchViewer.tsx, src/components/session/Badge/__tests__/BadgeContent.test.ts]
createdAt: 2025-12-13T16:00:36.185Z
updatedAt: 2025-12-15T02:54:28.361Z
---

**Purpose**: Document the props contract and UI responsibilities for `BadgeKnowledgeBaseSearchContent` so regressions like the prior `llmResult` ReferenceError or missing cached previews do not recur.

**Key Points**
- `BadgeKnowledgeBaseSearchContent` must receive four props: `badgeId`, optional `searchKey`, optional `fullParams` (`Record<string, unknown> | null`), and optional `llmResult` (`KnowledgeBaseMinimalResult`). Always destructure them from the function signature.
- The component now keeps local `uiError`/`uiLoading` state along with the cached `resultsObj` fetched via `tool.getResult`. These setters must be declared before use; they gate the cached preview copy and prevent TS errors.
- `searchKey` enables the "Cached KB Preview" section. When present, the component fetches UI-only payloads, renders them via `renderHits`, and exposes the raw cached JSON blob beneath the accordion list.
- `llmResult` continues to represent the minimal payload shown to models. Render its hits separately from the cached preview, and show the exact JSON string in the "Raw payload sent to model" block for transparency.
- Files touched: `src/components/BadgeKnowledgeBaseSearchContent.tsx`, `src/components/session/Badge/viewers/KBSearchViewer.tsx`, `src/components/session/Badge/__tests__/BadgeContent.test.ts`.
- Tests: `src/components/session/Badge/__tests__/BadgeContent.test.ts` exercises badge viewer selection; extend it if additional props are added.