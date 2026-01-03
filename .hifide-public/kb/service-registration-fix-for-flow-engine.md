---
id: df551598-0a4f-4f91-85f1-11b72140a0b9
title: Service Registration Fix for Flow Engine
tags: [bugfix, services, dependency-injection]
files: [electron/services/index.ts, electron/services/base/ServiceRegistry.ts, electron/flow-engine/session-timeline-writer.ts]
createdAt: 2026-01-03T21:44:58.717Z
updatedAt: 2026-01-03T21:44:58.717Z
---

Fixed a critical bug where flows failed to start because the `ServiceRegistry` was missing registered services.

### Issue
The `SessionTimelineWriter` (and potentially other parts of the flow engine) uses `ServiceRegistry.getInstance().get('workspace')` to access services. However, while `initializeServices()` in `electron/services/index.ts` was creating the service instances, it was not registering them with the `ServiceRegistry`.

### Fix
Updated `electron/services/index.ts` to register all singleton services with the `ServiceRegistry` during the `initializeServices()` call. This ensures that any component using the registry can successfully retrieve the required services.

### Registry Keys
- `settings`
- `provider`
- `app`
- `embedding`
- `vector`
- `workspace`
- `kbIndexer`
- `codeIndexer`
- `tools`
- `session`
- `kanban`
- `knowledgeBase`
- `mcp`
- `explorer`
- `languageServer`
- `gitStatus`
- `gitDiff`
- `gitLog`
- `gitCommit`
- `flowGraph`
- `flowContexts`
- `flowProfile`
- `flowCache`
- `workspaceSearch`