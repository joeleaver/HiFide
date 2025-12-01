---
id: f7b8eb98-bb4f-4b36-9323-fe0c50fe8fbe
title: Tool Badge Display Fix
tags: [bug-fix, badge-system, timeline, tool-execution]
files: [electron/flow-engine/timeline-event-handler.ts, electron/store/types.ts, src/components/session/Badge/BadgeHeader.tsx]
createdAt: 2025-12-01T15:40:47.547Z
updatedAt: 2025-12-01T15:40:47.547Z
---

## Issue
Tool badges were rendering blank in the session timeline because badge objects created during tool execution were missing required properties.

## Root Cause
The `timeline-event-handler.ts` was creating badge objects in the `toolStart` event handler without including:
- `type: 'tool'` - Badge type identifier
- `label: string` - Display text shown in the UI
- `expandable: boolean` - Whether the badge can be expanded
- `contentType` - Type of content when expanded

The BadgeHeader component expects `badge.label` to render the tool name, but this property wasn't being set.

## Solution
Updated the `toolStart` event handler in `electron/flow-engine/timeline-event-handler.ts` to:
1. Format the tool name for display (e.g., "fs_read_file" → "fs.read.file")
2. Create badge objects with all required properties from the Badge type definition
3. Set proper status values ('running' instead of 'executing')

## Files Changed
- `electron/flow-engine/timeline-event-handler.ts`
  - Added `formatToolName()` helper function
  - Updated `toolStart` case to create proper Badge objects with `type`, `label`, `expandable`, and `contentType`