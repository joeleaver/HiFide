# FlowEditor Slice Refactor Analysis

## Problem

The `flowEditor.slice.ts` is **3,023 lines** and contains multiple responsibilities that should be separated:

1. **Graph state** (nodes/edges) - ~200 lines
2. **Badge rendering logic** - ~1,500 lines (DUPLICATE with SessionTimelineService)
3. **Profile management** - ~400 lines (DUPLICATE with FlowProfileService)
4. **Execution state** - ~300 lines (should be in SessionTimelineService)
5. **UI state** - ~200 lines (should be renderer-only)
6. **Event handlers** - ~400 lines (DUPLICATE with SessionTimelineService)

## Current State Analysis

### What the Scheduler ACTUALLY Needs

Looking at `flow-engine/scheduler.ts` and `flow-engine/flow-api.ts`:

```typescript
// Only accesses:
const nodeFromStore = store?.feNodes?.find((n: any) => n.id === nodeId)
const cfgFromStore = (nodeFromStore?.data as any)?.config
```

**That's it!** Just `feNodes` to read node configs during execution.

### What's Already in SessionTimelineService ✅

**Badge handlers (lines 1050-1400):**
- ✅ toolStart → creates badge with metadata
- ✅ toolEnd → updates badge with expansion + contentType
- ✅ toolError → creates error badge
- ✅ chunk → buffers streaming text
- ✅ reasoning → buffers reasoning text
- ✅ usageBreakdown → creates usage badge
- ✅ Badge expansion for: workspace-search, fs.read_lines, fs.read_file, edits.apply, kb-search, kb-store, workspace-jump, workspace-map, agent-assess

**Event handlers:**
- ✅ nodeStart, nodeEnd, done, error
- ✅ Debounced flushing to session timeline
- ✅ Workspace notifications

### What's DUPLICATED in flowEditor.slice ❌

**Badge handlers (lines 1800-2600):**
- ❌ DUPLICATE toolEnd handlers for ALL tools
- ❌ DUPLICATE badge creation logic
- ❌ DUPLICATE metadata extraction
- ❌ DUPLICATE UiPayloadCache.put() calls
- ❌ DUPLICATE contentType assignment

**Event handlers (lines 2600-2900):**
- ❌ DUPLICATE feHandleToolStart
- ❌ DUPLICATE feHandleToolEnd
- ❌ DUPLICATE feHandleToolError
- ❌ DUPLICATE feHandleChunk
- ❌ DUPLICATE feHandleReasoning
- ❌ DUPLICATE feHandleUsageBreakdown

## Refactor Plan

### Step 1: Verify No Missing Badge Types ✅ COMPLETE

**SessionTimelineService has (6 types):**
- ✅ workspace-search
- ✅ read-lines (fs.read_lines + fs.read_file)
- ✅ diff (edits.apply)
- ✅ usage-breakdown

**flowEditor.slice has (14 occurrences, 9 unique types):**
- ✅ workspace-search (DUPLICATE)
- ✅ read-lines (DUPLICATE)
- ✅ diff (DUPLICATE)
- ✅ usage-breakdown (DUPLICATE)
- ❌ **search** (line 1956) - MISSING from SessionTimelineService
- ❌ **agent-assess** (line 2063) - MISSING from SessionTimelineService
- ❌ **kb-search** (line 2090) - MISSING from SessionTimelineService
- ❌ **kb-store** (line 2117) - MISSING from SessionTimelineService
- ❌ **workspace-jump** (line 2146) - MISSING from SessionTimelineService
- ❌ **workspace-map** (line 2172) - MISSING from SessionTimelineService
- ❌ **ast-search** (line 2283) - MISSING from SessionTimelineService

**Action:** Move these 7 missing badge types to SessionTimelineService

### Step 2: Move Missing Badge Logic ✅ COMPLETE

Moved all 7 missing badge handlers to SessionTimelineService (lines 1250-1420):
- ✅ index.search → 'search' contentType
- ✅ agentAssessTask → 'agent-assess' contentType
- ✅ knowledgeBaseSearch → 'kb-search' contentType
- ✅ knowledgeBaseStore → 'kb-store' contentType
- ✅ workspace.jump → 'workspace-jump' contentType
- ✅ workspace.map → 'workspace-map' contentType
- ✅ code.searchAst → 'ast-search' contentType

All badge handlers now in SessionTimelineService with proper UiPayloadCache integration.

### Step 3: Delete Duplicate Event Handlers

Delete all `feHandle*` methods from flowEditor.slice since SessionTimelineService already handles them.

### Step 4: Extract Graph Service

Create minimal `FlowGraphService` with ONLY:
- `feNodes: Node[]`
- `feEdges: Edge[]`
- `setNodes(nodes: Node[]): void`
- `setEdges(edges: Edge[]): void`
- `getNodes(): Node[]`
- `getEdges(): Node[]`

### Step 5: Move Profile Management

FlowProfileService already exists - verify it has all profile methods from flowEditor.slice.

### Step 6: Move UI State to Renderer

Move to renderer-only Zustand store:
- `feSelectedNodeId`
- `feSaveAsModalOpen`
- `feLoadTemplateModalOpen`
- `feNewProfileName`

### Step 7: Update Scheduler

Update scheduler to use `FlowGraphService.getNodes()` instead of `useMainStore.getState().feNodes`

### Step 8: Delete flowEditor.slice

Once all logic is moved, delete the entire file.

## Success Criteria

- ✅ Zero duplicate badge logic
- ✅ Zero duplicate event handlers
- ✅ Scheduler uses FlowGraphService
- ✅ All profile management in FlowProfileService
- ✅ All UI state in renderer
- ✅ flowEditor.slice.ts deleted
- ✅ All tests passing

