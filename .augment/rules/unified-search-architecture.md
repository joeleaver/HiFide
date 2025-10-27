---
type: "always_apply"
---

# Unified Natural Language Workspace Search — Architecture & Plan

Owner: Main process (Electron). Single entrypoint: workspace.search tool. Updated continuously.

## Goals
- Ultra-fast literal and phrase search: ripgrep via vscode-ripgrep
- Robust NL semantic retrieval: embeddings (transformers.js)
- Structure-aware search: AST-grep (existing)
- Unified corpus: Workspace code and Knowledge Base (KB)
- One API: workspace.search returns merged, ranked results with reasons [literal|semantic|ast] and corpus tag [workspace|kb]
- Replace legacy glob-as-search; keep globs only as include/exclude filters

## Phases

### Phase 1 (This PR)
- Add ripgrep lane (vscode-ripgrep). Safe fallback to current Node grep on failure.
- Maintain semantic lane (now powered by transformers.js).
- Document plan here and keep it updated.
- Package gating: ensure ripgrep binary is unpacked in asar (asarUnpack).

### Phase 2
- Make transformers.js (@xenova/transformers) the only embedding backend (fastembed removed).
- Unify KB into semantic index (either separate KB index or include .hifide-public/kb selectively).
- Startup gating: verify transformers model availability; surface clear errors if unavailable (no fastembed fallback).

### Phase 3
- Merge KB results into workspace.search by default (corpus tagging preserved).
- Add simple reranker (cosine with short cross-encoder later if needed).
- Add ripgrep JSON context stitching for before/after lines (optional polish).

## Design

- workspace.search backend executes three lanes in parallel:
  1) literal (ripgrep) → fast exact string/regex
  2) semantic (indexer.search) → vector similarity over chunks
  3) structure (AST-grep) → code-aware patterns
- Merge policy: dedupe by (path,line/window), combine reasons, compute blended score; sort by score desc.
- Filters: include/exclude globs applied uniformly; sensitive files always excluded (.env*, .hifide-private/secrets/**, api_key.txt).

## Packaging & Gating
- Dependencies: vscode-ripgrep (bin), @xenova/transformers, sharp (transformers dep), @ast-grep/napi (existing)
- electron-builder: add "**/vscode-ripgrep/**" and "**/sharp/**/*.{node,dll,so,dylib}" to asarUnpack so binaries are executable outside ASAR.
- Rebuild native deps for Electron: electron-rebuild for node-pty and sharp in dev/build; electron-builder install-app-deps on postinstall.
- transformers.js model cache path: set to Electron userData/models/transformers (fallback: ~/.hifide/models/transformers) to ensure writeable location across Windows/Linux/macOS.
- Runtime fallback: if ripgrep import fails, use Node grep implementation.
- Startup gating: if transformers import fails due to sharp/ABI, skip semantic rebuild and log actionable instructions: "pnpm approve-builds sharp" then "pnpm exec electron-rebuild -f -w sharp" (Windows/Electron).

## Migration
- Deprecate legacy glob-as-search path. Preserve handles, expand, cache APIs in workspace.search.
- KB: current substring search will be replaced by semantic + literal lanes, then routed through workspace.search.

## Security & Privacy
- Exclude secrets by default: `.env`, `.env.*`, `api_key.txt`, `.hifide-private/secrets/**`.
- Respect .gitignore for workspace search.

## Testing
- Add golden tests for queries like: "Find where '[main-store] changed keys' is printed".
- Verify ripgrep lane returns correct files/lines.
- Verify semantic returns top chunks for paraphrases.
- Verify AST-grep for logging/dispatch patterns.

## Status Log
- [x] Write plan (this file)
- [x] Integrate ripgrep (with fallback) into text.grep tool
  - Normalized ripgrep paths to workspace-relative with platform separators
  - Explicitly load workspace .gitignore and added post-filter for parity on Windows
  - Skip ripgrep for tiny pages (<=5 results) to preserve pagination cursor behavior in tests
- [x] Install deps (vscode-ripgrep, @xenova/transformers)
  - ripgrep binary download approved via pnpm approve-builds
- [x] Update workspace.search to leverage ripgrep improvements (already calls grepTool)
- [x] Add asarUnpack entry for ripgrep
- [x] Add KB to semantic corpus (Phase 2)
- [x] Transformers-only backend (fastembed removed) (Phase 2)
- [ ] Merge KB into workspace.search results (Phase 3)

## Notes
- Keep workspace.search as the single entrypoint for LLMs.
- Indexing now uses transformers.js only; no fastembed fallback.
- Performance target: ripgrep path should answer literal queries under ~50ms on typical repos; semantic recall k≈8 within ~150ms warmed.

