---
id: 30e8e5d5-bdd2-4466-99e8-9c4da577f22a
title: LanceDB and apache-arrow Build Requirements
tags: [build, windows, lancedb, apache-arrow]
files: [package.json]
createdAt: 2026-01-06T17:35:18.317Z
updatedAt: 2026-01-06T17:35:18.317Z
---

# LanceDB and apache-arrow on Windows

When building for Windows, `@lancedb/lancedb` requires `apache-arrow` as a peer dependency. If `apache-arrow` is missing from the main `package.json` dependencies, the built application will fail with `Cannot find module 'apache-arrow'`.

Additionally, LanceDB's native modules (`.node` files) must be unpacked from the ASAR archive to function correctly.

## Resolution

1.  **Add `apache-arrow` to dependencies:**
    ```json
    "dependencies": {
      "apache-arrow": "^18.1.0",
      "@lancedb/lancedb": "^0.23.0"
    }
    ```

2.  **Unpack native modules in `electron-builder` config:**
    Update `asarUnpack` in `package.json`:
    ```json
    "build": {
      "asarUnpack": [
        "**/@lancedb/lancedb*/**/*.node"
      ]
    }
    ```

3.  **Remove outdated packages:**
    Ensure the outdated `lancedb` (0.0.1) package is removed as it may conflict with `@lancedb/lancedb`.
