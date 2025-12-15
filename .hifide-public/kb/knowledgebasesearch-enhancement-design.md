---
id: 443c01e7-372f-488f-9e21-c16ce4ee1caf
title: knowledgebaseSearch enhancement design
tags: [knowledge-base, tooling, search]
files: [electron/tools/kb/search.ts, electron/store/utils/knowledgeBase.ts, electron/__tests__/tools/knowledgeBase.test.ts, electron/flow-engine/badge-processor.ts, src/components/BadgeKnowledgeBaseSearchContent.tsx, src/components/session/Badge/viewers/KBSearchViewer.tsx, src/components/session/Badge/inferContentType.ts, src/components/session/Badge/__tests__/BadgeContent.test.ts]
createdAt: 2025-12-12T20:39:00.499Z
updatedAt: 2025-12-12T20:50:40.248Z
---

## Status
Implemented multi-phase knowledge base search and badge transparency.

## Implementation highlights
1. **Tokenized fallback search**
   - `electron/store/utils/knowledgeBase.ts` now tokenizes multi-word queries (min length 3, stopword-trimmed) and, when literal substring matches fail, scores entries by token coverage + title/tag/file/body frequency with excerpts sourced from the first hit.
   - Fallback candidates are sorted by score and clipped to the requested `limit`, ensuring deterministic ordering even when no literal match exists.
2. **Tool payloads with IDs**
   - `electron/tools/kb/search.ts` returns normalized hits (`id`, `title`, `tags`, `files`, `path`, `excerpt`, `score`) to the LLM while caching the richer UI payload behind a preview key. The minimal response no longer exposes `previewKey` but does include `resultCount` and `results` for downstream `knowledgeBaseStore` updates.
   - Jest coverage in `electron/__tests__/tools/knowledgeBase.test.ts` exercises both literal and fallback paths plus the `toModelResult` shape.
3. **Badge experience**
   - Badge config (`electron/flow-engine/badge-processor.ts`) emits `contentType: 'kb-search'`, search params, `resultCount`, and keeps badges expandable even without cached previews.
   - Renderer components (`src/components/BadgeKnowledgeBaseSearchContent.tsx`, `src/components/session/Badge/viewers/KBSearchViewer.tsx`) mirror the workspace search workflow: the badge expansion shows search parameters, the exact LM payload (with JSON block), and the optional cached preview via `tool.getResult`.
   - `inferContentType` + tests now recognize both dotted and camelCase KB search tool names.

## Follow-up considerations
- Consider exposing the computed token scores/excerpt origins in the LM payload metadata if agents need to justify matches further.
- Token stopword list is minimal; adjust if noisy terms emerge in real projects.
