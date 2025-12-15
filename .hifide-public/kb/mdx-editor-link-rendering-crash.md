---
id: 51e551e8-97a9-4104-b00a-9759446f7e6a
title: MDX editor link rendering crash
tags: [mdx, editor, links]
files: [src/lib/editor/markdownLinkNormalizer.ts, src/lib/editor/__tests__/markdownLinkNormalizer.test.ts, src/components/KnowledgeBaseView.tsx, src/components/ExplorerView.tsx]
createdAt: 2025-12-11T03:42:30.972Z
updatedAt: 2025-12-11T04:06:05.794Z
---

## Summary
MDXEditor cannot parse markdown reference nodes (link/image references or the trailing `[label]:` definition syntax). We prevent crashes by normalizing workspace markdown before it reaches the editor.

## Implementation
- `src/lib/editor/markdownLinkNormalizer.ts`
  - Collects non-footnote reference definitions, converts both link and image reference syntaxes (`[text][ref]`, `[ref][]`, `[ref]`, `![alt][ref]`, etc.) into inline markdown, and removes the now-unneeded `[label]: ...` lines.
  - Shortcut conversion skips escaped sequences, nested bracket contexts, and inline links/images that are already valid.
  - Collapses excessive blank lines after removing definitions and is idempotent so repeated normalization is safe.
- `KnowledgeBaseView.tsx` and `ExplorerView.tsx`
  - Run `normalizeReferenceLinks(...)` inside the `useMemo`/sanitization step before rendering MDXEditor tabs so pasted markdown can include GitHub-style references without blanking the editor.

## Tests
- `src/lib/editor/__tests__/markdownLinkNormalizer.test.ts` covers link, image, shortcut, and standalone definition scenarios to guard against regressions.