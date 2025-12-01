# Session Timeline Unified Architecture

**Date**: 2025-11-27  
**Status**: 🎯 DESIGN PHASE

## Current State Analysis

### What's Stored in Main Process

Currently, the timeline event handler stores **raw tool data** in badges:

```typescript
// electron/flow-engine/timeline-event-handler.ts
toolCalls.push({
  id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  toolName: ev.toolName,
  callId: ev.callId,
  args: ev.toolArgs,        // ✅ Raw args stored
  status: 'executing',
  timestamp: Date.now(),
})

// On toolEnd:
tool.result = ev.result      // ✅ Raw result stored
```

### What's in Badge Type

```typescript
// electron/store/types.ts
export type Badge = {
  id: string
  type: BadgeType
  toolName?: string
  status?: 'running' | 'success' | 'error'
  
  // Expandable support
  expandable?: boolean
  contentType?: 'diff' | 'search' | 'workspace-search' | 'read-lines' | ...
  
  // Interactive data (KEY FINDING!)
  interactive?: {
    type: 'diff' | 'link' | 'action' | ...
    data: any  // ⚠️ Currently stores a "key" for RPC lookup
  }
  
  // Metadata for header display
  metadata?: {
    fileCount?: number
    filePath?: string
    resultCount?: number
    query?: string
    fullParams?: any
    [key: string]: any
  }
}
```

### Current Renderer Behavior

**For expandable badges**, the renderer:
1. Checks `badge.interactive?.data?.key`
2. Makes RPC call: `client.rpc('tool.getResult', { key: searchKey })`
3. Renders the fetched data

**Examples:**
- `BadgeSearchContent` - Fetches search results via RPC
- `BadgeDiffContent` - Fetches diff data via RPC
- `BadgeKnowledgeBaseSearchContent` - Fetches KB results, then loads full bodies on demand

## 🎯 Proposed Unified Architecture

### Principle: One Component Per Timeline Item Type

Instead of separate "formatters", we have **one reusable component per item type**:

1. **`<SessionMessage>`** - User/assistant messages
2. **`<NodeExecutionBox>`** - Node execution with streaming content
3. **`<Badge>`** - Tool execution badges (unified component)

### Badge Component Architecture

```typescript
// src/components/session/Badge.tsx
export function Badge({ badge }: { badge: BadgeType }) {
  return (
    <BadgeContainer
      badge={badge}
      header={<BadgeHeader badge={badge} />}
      content={<BadgeContent badge={badge} />}
    />
  )
}

// BadgeContent.tsx - Smart content renderer
function BadgeContent({ badge }: { badge: BadgeType }) {
  // Determine content type from badge.toolName or badge.contentType
  const contentType = badge.contentType || inferContentType(badge.toolName)
  
  switch (contentType) {
    case 'diff':
      return <DiffViewer badge={badge} />
    case 'read-lines':
      return <CodeViewer badge={badge} />
    case 'workspace-search':
      return <SearchResults badge={badge} />
    case 'kb-search':
      return <KBSearchResults badge={badge} />
    default:
      return <JsonViewer badge={badge} />
  }
}
```

### Data Storage Strategy

**Two-tier approach:**

#### Tier 1: Inline Data (No RPC needed)
Store small, essential data directly in badge:
- Tool args (always small)
- Summary metrics (file count, line counts, etc.)
- Short results (< 1KB)

#### Tier 2: On-Demand Data (RPC when expanded)
Store large data in UiPayloadCache, reference by key:
- Full diff content
- Search results with code snippets
- Large file contents
- KB entry bodies

**Decision criteria:**
- **< 1KB**: Store inline in badge
- **> 1KB**: Store in cache, reference by key

### Example: edits.apply Badge

```typescript
// Main process stores:
{
  toolName: 'edits.apply',
  args: { files: ['foo.ts', 'bar.ts'] },
  result: {
    success: true,
    files: [
      { path: 'foo.ts', status: 'success' },
      { path: 'bar.ts', status: 'success' }
    ]
  },
  metadata: {
    fileCount: 2,
    addedLines: 15,
    removedLines: 8
  },
  interactive: {
    type: 'diff',
    data: { key: 'diff-abc123' }  // Full diffs stored in cache
  }
}

// Renderer displays:
// - Header: "edits.apply" + status light + pills (+15, -8)
// - Collapsed: File list (foo.ts, bar.ts)
// - Expanded: Full diffs (fetched via RPC on first expand)
```

## 🏗️ Implementation Plan

### Phase 1: Audit Current Data Flow ✅
- [x] Understand what's stored in badges
- [x] Understand current RPC pattern
- [x] Identify inline vs on-demand data

### Phase 2: Create Unified Badge Component
1. Create `src/components/session/Badge/` directory
2. Build `<Badge>` wrapper component
3. Build `<BadgeHeader>` (status light, tool name, pills, expander)
4. Build `<BadgeContent>` dispatcher
5. Build content viewers:
   - `<DiffViewer>` (reuse existing)
   - `<CodeViewer>` (for read-lines)
   - `<SearchResults>` (reuse existing)
   - `<KBSearchResults>` (reuse existing)
   - `<JsonViewer>` (default fallback)

### Phase 3: Update Timeline Renderer
1. Replace `ToolBadgeContainer` with new `<Badge>`
2. Remove tool-specific rendering logic from SessionPane
3. Simplify timeline rendering loop

### Phase 4: Optimize Data Storage
1. Audit all tools to determine inline vs cache
2. Update timeline-event-handler to store appropriate data
3. Ensure UiPayloadCache is used consistently

## 📊 Benefits

1. **Consistent UX** - All badges look and behave the same
2. **Reusable** - One Badge component, not 10+ formatters
3. **Composable** - Content viewers are independent components
4. **Performant** - Only fetch large data when expanded
5. **Maintainable** - Adding new tools = add one content viewer
6. **Type-safe** - Badge type drives rendering logic

## 🤔 Open Questions

1. **Should we store args/result directly in badge, or always use cache?**
   - **Recommendation**: Inline for small data (< 1KB), cache for large
   
2. **Should content viewers handle their own RPC calls?**
   - **Recommendation**: Yes - each viewer knows what data it needs
   
3. **Should we have a "loading" state for RPC fetches?**
   - **Recommendation**: Yes - show skeleton while fetching

4. **Should we cache fetched data in renderer?**
   - **Recommendation**: Yes - store in local state, don't re-fetch on collapse/expand

## Next Steps

1. Get user approval on architecture
2. Create unified Badge component
3. Migrate existing badge rendering
4. Test with all tool types
5. Document badge data requirements for new tools

