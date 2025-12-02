---
id: 26a5634a-3d51-44bc-b75e-4be25ee08ab7
title: Portal Output Node - Handle Visibility Fix
tags: [portal-nodes, ui-bug, handle-rendering, flow-editor]
files: [src/components/FlowNode/NodeHandles.tsx, electron/flow-engine/nodes/portalOutput.ts, electron/flow-engine/nodes/portalInput.ts]
createdAt: 2025-12-01T23:03:44.134Z
updatedAt: 2025-12-01T23:03:44.134Z
---

## Issue
Portal Output nodes were showing no output handles (edges invisible, unconfigurable) when:
- No portal ID was configured
- No matching Portal Input node exists
- Matching Portal Input has no connected inputs

## Root Cause
The Portal Output handle generation logic in `NodeHandles.tsx` was **fully dynamic** with no fallback. If it couldn't find a matching Portal Input with connections, it would render **zero output handles**, making:
- Existing edges invisible
- New edge connections impossible
- Node effectively non-functional in the UI

## Solution
Added a fallback mechanism that always shows at least **Context Out** handle when no matching Portal Input is found. This ensures:
- Edges remain visible even when Portal Input doesn't exist yet
- Users can configure connections before setting up the matching Portal Input
- Node is always functional in the UI

## Code Location
`src/components/FlowNode/NodeHandles.tsx` - Portal Output handle generation (lines ~80-110)

## Related Nodes
- Portal Input (`portalInput`) - Stores context/data in registry
- Portal Output (`portalOutput`) - Retrieves context/data from registry
- Scheduler logic: `electron/flow-engine/scheduler.ts` - `triggerPortalOutputs()`
