---
id: e1958d69-fa54-4049-95a8-9b1a65fdd7a3
title: Troubleshooting tree-sitter C++20 Build Errors
tags: [build, tree-sitter, electron, windows, c++20]
files: []
createdAt: 2026-01-04T04:43:31.660Z
updatedAt: 2026-01-04T04:43:31.660Z
---

## Problem
The `tree-sitter@0.25.0` package fails to build on Windows in Electron 33.2.1 environments because the V8 headers provided by Electron require C++20, but the build process is defaulting to C++17 or lower, or is being explicitly overridden.

### Symptoms
- Error: `C:\Users\joe\.electron-gyp\33.2.1\include
ode\v8config.h(13,1): error C1189: #error: "C++20 or later required."`
- Warning: `cl : command line warning D9025: overriding '/std:c++20' with '/std:c++17'`

## Solution Strategy
1. **Standardize Build Environment**: Ensure `npm_config_msvs_version=2022` and that the correct C++ standard is targeted.
2. **Patch binding.gyp**: If the dependency's `binding.gyp` is forcing C++17, it must be patched to C++20 for compatibility with modern Electron.
3. **Electron Rebuild Configuration**: Use flags to ensure the environment propagates C++20.

## Related Files
- `package.json`
- `node_modules/tree-sitter/binding.gyp`
