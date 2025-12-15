Release date: 2025-12-10

## Highlights

* Explorer/Editor
* Many bugfixes

## Details

### MCP Support

* http/stdin/websockets
* configure by pasting-in json or manually
* configure in tools node

### Explorer/Editor

* language server support with auto-installation
* First-class markdown support with built-in markdown editor
* Colors and icons in file tree
* Workspace search and replace

### Many Bugfixes

* mostly related to workspace isolation

***

Release date: 2025-11-12

## Highlights

* This What's New message
* Support multiple windows
* User input now supports Markdown
* MiniMax‑M2 configured by default for the Fireworks provider
* Decoupled flow editor from running flow
* Save flows to the workspace

## Details

### Multiple windows (multi‑workspace)

You can now open more than one HiFide window at the same time and bind each one to a different workspace.

* File → New Window (Cmd/Ctrl+Shift+N)
* New windows start on the Welcome screen so you can pick a different folder
* Opening the same workspace in two windows is prevented to avoid crosstalk

This enables side‑by‑side development and testing across separate projects with full isolation of flows, tools, search, and terminals.

### Markdown input in chat

The session input box now accepts Markdown formatting. Use code blocks, lists, links, and inline formatting to craft clearer prompts.

* Triple‑backtick (\`\`\`) code fences for multi‑line code
* Inline code with single backticks
* Bulleted/numbered lists for structured steps

Your formatting is preserved for the model, improving clarity and results.

### New Fireworks model: MiniMax‑M2

For the Fireworks provider, MiniMax‑M2 is auto-configured as a default model. This provides strong reasoning and code capabilities out of the box. You can still change models at any time in Settings.

### Decoupled flow editor from running flow

The flow editor and running flow are now decoupled. You can edit any flow, whether it is the currently-executing flow or not.

### Save flows to the workspace

Now there are three sources of flows:

* System flows (built‑in)
* User flows (global)
* Workspace flows (`.hifide-public/flows`)

You can save flows to the workspace from the flow editor. They will be available in new sessions created within that workspace.