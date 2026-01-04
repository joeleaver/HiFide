---
id: fe48194a-1527-41d5-ada3-780d755d73d9
title: Troubleshooting Electron GPU / Skia Mailbox errors
tags: [electron, gpu, troubleshooting, crash]
files: [electron/main.ts]
createdAt: 2026-01-04T02:51:41.068Z
updatedAt: 2026-01-04T02:51:41.068Z
---

Chrome/Electron GPU errors like `SharedImageManager::ProduceSkia: Trying to Produce a Skia representation from a non-existent mailbox` or `crashpad_client_win.cc(868) not connected` often indicate issues with hardware acceleration or driver incompatibilities.

To resolve these, we have disabled hardware acceleration at the application level in `electron/main.ts` using `app.disableHardwareAcceleration()`. This should be done before the app is ready.

If UI performance degrades significantly, consider more granular GPU flags or investigating specific driver versions, though for a dev tool/IDE, CPU rendering is usually acceptable as a stable baseline.