---
id: 4902bf8e-2086-49c8-90f5-a0b94ee8674a
title: Linux Build Compatibility & Version Pinning
tags: [build, linux, electron, node-pty]
files: [package.json]
createdAt: 2026-01-03T23:31:51.991Z
updatedAt: 2026-01-03T23:32:51.089Z
---

# Linux Build Compatibility & Version Pinning

## Overview
To ensure build stability across different Linux distributions, specific versions of `electron` and `node-pty` must be pinned in `package.json`.

## Version Specifications
- **Electron**: `33.2.1`
  - Reason: Newer versions (38+) have reported build issues on certain Linux environments.
- **node-pty**: `1.0.0`
  - Reason: Our project uses a custom patch located at `patches/node-pty@1.0.0.patch`. Pinning to exactly `1.0.0` ensures the patch applies correctly during installation.

## Post-Update Instructions
After updating these versions, Linux users should perform the following steps:
1. Delete `node_modules`.
2. Run `pnpm install`.
3. Run `pnpm rebuild:native` to ensure native modules are compiled against the correct Electron headers.

## Reference
- Task: `task-84950821-d41a-4c28-9710-917711910609` (Correction)
- Original Task: `task-4c234df9-26e2-4ce4-a8e2-a01ef5be74a9` (Pinned to 1.1.0 incorrectly)
