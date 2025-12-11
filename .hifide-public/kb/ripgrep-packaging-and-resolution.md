---
id: 3a613870-f423-48fc-8634-ff83e8709150
title: Ripgrep packaging and resolution
tags: [packaging, search, electron]
files: [electron/services/WorkspaceSearchService.ts, electron/tools/text/grep.ts, electron/utils/ripgrep.ts, electron/utils/__tests__/ripgrep.test.ts, package.json]
createdAt: 2025-12-11T00:33:20.068Z
updatedAt: 2025-12-11T00:37:07.759Z
---

- Electron builds ship the `vscode-ripgrep` binary and require it to be unpacked because Windows cannot execute from inside `app.asar`.  
- `package.json` configures `build.asarUnpack` with `**/vscode-ripgrep/**` so binaries land in `resources/app.asar.unpacked/node_modules/vscode-ripgrep/bin`.  
- `electron/utils/ripgrep.ts` exposes `preferUnpackedRipgrepPath(rawPath)` which normalizes the module-provided path and rewrites `app.asar` to `app.asar.unpacked` when the unpacked binary exists.  
- `WorkspaceSearchService` and the text grep tool both import this helper so every ripgrep spawn uses the unpacked path inside production builds while keeping development paths untouched.  
- The helper is covered by `electron/utils/__tests__/ripgrep.test.ts` to lock in the path rewriting behavior.