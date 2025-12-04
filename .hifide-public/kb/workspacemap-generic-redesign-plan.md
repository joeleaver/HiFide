---
id: 197ad9e8-cbe2-45e8-b843-6d7981df61e8
title: workspaceMap generic redesign plan
tags: [workspaceMap, design, tooling]
files: [electron/tools/workspace/map.ts]
createdAt: 2025-12-03T22:05:12.584Z
updatedAt: 2025-12-03T22:05:12.584Z
---

## Goals
- Provide a language/tooling-agnostic map so any repository (web, backend, CLI, infra) produces useful structure hints.
- Keep output compact (respect `maxPerSection`) and fast (rely on shallow globbing + optional grep within the time budget).
- Preserve the current tool contract (`{ root, sections, exampleQueries, meta }`) so downstream agents continue to work.

## Output structure
`sections` stays an array of `{ title, items[] }`, but each section now mirrors generic repository slices:
1. **Top-level directories** – summarise up to `maxPerSection` non-ignored directories (and root files) with file counts and dominant extensions.
2. **Language breakdown** – aggregate counts by extension groups (TS, JS, Python, Go, Rust, JVM, C/C++, C#, Ruby, PHP, Swift, Shell, Markdown, Config). Each item includes sample file handles.
3. **Manifests & dependency files** – package.json, requirements.txt, pyproject, go.mod, Cargo.toml, Gemfile, composer.json, mix.exs, etc.
4. **Build & tooling configs** – tsconfig, webpack/vite/rollup/babel configs, eslint/jest/vitest configs, Makefiles, justfile, Taskfile, etc.
5. **Docs & knowledge** – README, docs/**, handbook/**, guides/** (md/mdx), ADRs, design docs.
6. **Tests & quality** – `tests/**`, `test/**`, `**/*.spec.*`, `**/*.test.*`, pytest files, Go/Rust test files.
7. **Infrastructure & deployment** – Dockerfiles, docker-compose, Terraform, Pulumi, Helm, Kubernetes manifests, CI pipelines (.github/workflows, .gitlab-ci.yml, CircleCI, Azure).
8. **Entry points & binaries** – src/main|index, cmd/**/main, server.* , cli.* , `if __name__ == "__main__"`, `package main`, etc.
9. **Landmarks (enriched mode)** – time-budgeted ripgrep scans for HTTP routes (`router`, `app.get`, `@app.route`), CLIs (`argparse`, `click.command`, `yargs`), schedulers (`cron.schedule`, `Agenda(`), DB migrations (`knex.schema`, `PrismaClient`, `ActiveRecord::Migration`), etc.

`exampleQueries` updated to be framework-neutral ("primary entrypoint", "infra config", "database migrations", ...).

## Implementation notes
- Keep the existing ignore glob list; also skip top-level names like node_modules, dist, .git, build outputs when enumerating directories.
- Reuse the shared helpers (`listFiles`, `toHandle`, `safeStat`). Add helpers:
  - `summarizeDirectory(dirRel)` – glob up to a shallow depth (e.g., deep 5, cap 2k files) to compute fileCount + top extensions; return `handle` pointing to the first file for quick jump.
  - `collectLanguageStats()` – run a single glob over `**/*.{ts,tsx,js,jsx,py,go,rb,rs,java,kt,cs,cpp,c,h,php,swift,scala,sh,ps1,json,yml,yaml,md,mdx}`; bucket by extension→language.
  - `collectFileGroup(title, patterns, why)` – generic helper to build manifest/config/doc/test/infra sections while respecting `maxPerSection`.
  - `runLandmarkGreps()` – only when `mode === 'enriched'` **and** time budget remains; use `grepTool` with generic regex signatures and cap matches per section.
- Ensure every list is deduped and truncated to `maxPerSection`; include `why` whenever possible so the UI can explain why a file surfaced.
- Preserve `toModelResult` behavior; `meta.mode` continues to echo the chosen mode; add `meta.elapsedMs` like today.

## File(s)
- `electron/tools/workspace/map.ts`
