---
id: dd1fa5a3-ee63-40d0-a585-e57176137240
title: Troubleshooting Tree-sitter Build Errors
tags: [electron, tree-sitter, cpp20, windows]
files: [package.json, patches/tree-sitter@0.25.0.patch]
createdAt: 2026-01-04T04:49:26.470Z
updatedAt: 2026-01-04T04:49:26.470Z
---

# Tree-sitter Build Issues (Windows)

## Symptoms
`error C1189: #error: "C++20 or later required."` during `electron-rebuild` for `tree-sitter@0.25.0`.
Logs show: `cl : command line warning D9025: overriding '/std:c++20' with '/std:c++17'`.

## Cause
`tree-sitter` 0.25.0 requires C++20. However, `node-gyp` or internal `binding.gyp` logic might default to C++17 or append it after our forced C++20 flag, causing an override.

## Resolution (Work in Progress)
- [x] Patched `tree-sitter`'s `binding.gyp` to use `/std:c++20`.
- [x] Added `CL="/std:c++20"` to rebuild script.
- [ ] Investigate `node-gyp` behavior regarding flag ordering.
- [ ] Check if `electron-rebuild` version (4.0.2) or `node-gyp` version (10.3.1/11.5.0 mismatch) is involved.
