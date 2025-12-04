---
id: 7dea6752-dde4-4646-8fa3-8f20246f401b
title: workspaceMap rewrite plan
tags: [workspaceMap, tools, implementation]
files: [electron/tools/workspace/map.ts]
createdAt: 2025-12-03T22:42:12.512Z
updatedAt: 2025-12-03T22:45:00.315Z
---

workspaceMap was rebuilt to be stack-agnostic and always run at full fidelity (no parameters). Implementation summary:
- `electron/tools/workspace/map.ts` now gathers complete workspace file metadata (via fast-glob + stats) while ignoring common vendor/build paths.
- High-signal sections:
  1. **Dependency influence** – ripgrep (`grepAllPages`) scans JS/TS, Python, Go, Rust, Java/Kotlin import statements; relative/path-like specs are resolved to workspace files with heuristic extension/index handling, producing an in-degree ranking.
  2. **Largest / densest modules** – ranks biggest text/code files, reading each to count lines and symbol keywords.
  3. **Configuration anchors** – scans root/near-root files under 200 KB, classifies configs via content cues (structured data, key/value directives, shebangs, keywords) and surfaces summaries.
- Always appends a Markdown directory tree (depth 3, capped children) built from real fs traversal, plus metadata (file counts, total/max bytes, top extensions/languages).
- Tool description updated to reflect new behavior; `parameters` schema is an empty object.
- Lint verified via `pnpm exec eslint electron/tools/workspace/map.ts`.