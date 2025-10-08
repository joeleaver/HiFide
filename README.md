# HiFide

Electron-based AI coding assistant with a chat UI. This README covers installation and usage. For design/architecture, see docs/.

## Prerequisites
- Node.js 20+
- pnpm 9+
- Windows, macOS, or Linux

## Install

```sh
pnpm install --frozen-lockfile --reporter=silent
```

## Develop (runs Vite + auto-starts Electron)

```sh
pnpm dev
```

## Build packaged app

```sh
pnpm build
```

Artifacts are produced by electron-builder. Code signing is optional for local builds.

## Configure API key
1. Launch the app
2. Open Settings
3. Paste your OpenAI API key and Save (stored securely via OS keychain)

## Documentation
See the docs folder:
- docs/architecture.md
- docs/tools.md
- docs/retrieval.md
- docs/verification.md
- docs/roadmap.md
