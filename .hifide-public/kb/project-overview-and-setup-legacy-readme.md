---
id: 4065ffb1-323f-46f9-a47b-ab316511e000
title: Project overview and setup (legacy README)
tags: [overview, documentation, legacy]
files: [README.md]
createdAt: 2025-11-03T21:27:41.022Z
updatedAt: 2025-11-03T21:27:41.022Z
---

## Summary
- Desktop Electron + React application that exposes an agentic coding assistant with chat-first UI and optional tools (filesystem write, terminal, structured edits, indexing).
- Supports multiple LLM providers (OpenAI, Anthropic, Google Gemini) with adapters and provider capability metadata.
- Core features include streaming chat, provider orchestration, secure API key storage via keytar, optional local indexing, and guardrailed tool usage.
- Current README is noted as **out of date**; treat the linked setup/dev commands (pnpm dev/lint/build) and provider instructions as legacy defaults.

## Key Requirements (legacy)
- Node.js 20+, pnpm 9+ via Corepack.
- macOS/Windows/Linux support with provider API keys configured through in-app settings or environment variables.

## Developer workflows (legacy defaults)
- `pnpm dev` runs Vite renderer + Electron for hot-reload development.
- `pnpm lint`, `pnpm build`, `pnpm preview` remain the documented lint/build/test entry points.
- Packaging performed via electron-builder outputs under `dist/`, `dist-electron/`, and `release/`.

> ⚠️ The README predates recent architectural changes; confirm instructions against current code before sharing externally.