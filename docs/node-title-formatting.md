# Node Title Formatting in Chat Stream

## Overview

Node output boxes in the chat stream now display titles in a standardized format:
**`<NODE TYPE>: <NODE TITLE>`**

For example:
- `LLM REQUEST: My Custom Node`
- `INTENT ROUTER: Route User Intent`
- `TOOLS` (when no custom title is set)

## Implementation

### Centralized Utilities

All node title formatting logic is centralized in `electron/store/utils/node-colors.ts`:

#### NODE_KIND_LABELS Mapping

```typescript
export const NODE_KIND_LABELS: Record<string, string> = {
  defaultContextStart: 'Context Start',
  userInput: 'User Input',
  manualInput: 'Manual Input',
  newContext: 'New Context',
  llmRequest: 'LLM Request',
  tools: 'Tools',
  intentRouter: 'Intent Router',
  parallelSplit: 'Split',
  parallelJoin: 'Merge',
  redactor: 'Redactor',
  budgetGuard: 'Budget Guard',
  errorDetection: 'Error Detection',
  approvalGate: 'Approval Gate',
  portalInput: 'Portal In',
  portalOutput: 'Portal Out',
}
```

#### Helper Functions

**`getNodeKindLabel(kind)`** - Get human-readable label for a node kind:
```typescript
getNodeKindLabel('llmRequest') // Returns: 'LLM Request'
getNodeKindLabel('intentRouter') // Returns: 'Intent Router'
```

**`formatNodeTitle(nodeKind, nodeLabel)`** - Format title for display:
```typescript
// With custom label
formatNodeTitle('llmRequest', 'My Custom Node')
// Returns: 'LLM REQUEST: My Custom Node'

// Without custom label (or label same as kind)
formatNodeTitle('llmRequest', 'LLM Request')
// Returns: 'LLM REQUEST'

// Unknown kind
formatNodeTitle('unknown', 'Custom')
// Returns: 'UNKNOWN: Custom'
```

### Component Updates

#### NodeOutputBox Component

The `NodeOutputBox` component automatically formats titles:

```typescript
export function NodeOutputBox({ nodeLabel, nodeKind, provider, model, cost, children }: NodeOutputBoxProps) {
  const displayTitle = formatNodeTitle(nodeKind, nodeLabel)
  
  return (
    <Stack>
      {displayTitle && (
        <div style={{ backgroundColor: color }}>
          <Text tt="uppercase">{displayTitle}</Text>
        </div>
      )}
      {/* ... */}
    </Stack>
  )
}
```

#### Usage in Session Items

**Messages:**
```typescript
// When adding assistant message
addSessionItem({
  type: 'message',
  role: 'assistant',
  content: streamingText,
  nodeLabel: node?.data?.label || 'LLM Request',  // Custom or default label
  nodeKind: node?.data?.kind || 'llmRequest',     // Node type
})

// Rendered as: "LLM REQUEST: Custom Label" or "LLM REQUEST"
```

**Badge Groups:**
```typescript
// When adding badges
addBadge({
  badge: { type: 'tool', label: 'codebase-search', ... },
  nodeLabel: 'Tools',
  nodeKind: 'tools',
})

// Rendered as: "TOOLS"
```

### Migration from Old Format

**Before:**
- Titles were just the raw `nodeLabel` value
- Example: `"ASSISTANT"`, `"Tools"`, `"Intent Router"`

**After:**
- Titles follow the `<TYPE>: <LABEL>` format
- Examples:
  - `"LLM REQUEST"` (no custom label)
  - `"LLM REQUEST: My Custom Node"` (with custom label)
  - `"TOOLS"` (no custom label)
  - `"INTENT ROUTER: Route User Intent"` (with custom label)

## Examples

### LLM Request Node

**Default (no custom label):**
```
┌─────────────────────────────┐
│ LLM REQUEST                 │
├─────────────────────────────┤
│ Here is my response...      │
└─────────────────────────────┘
```

**With custom label:**
```
┌─────────────────────────────┐
│ LLM REQUEST: Code Generator │
├─────────────────────────────┤
│ Here is the generated code..│
└─────────────────────────────┘
```

### Intent Router Node

**Default:**
```
┌─────────────────────────────┐
│ INTENT ROUTER               │
├─────────────────────────────┤
│ 🎯 greeting                 │
└─────────────────────────────┘
```

**With custom label:**
```
┌─────────────────────────────┐
│ INTENT ROUTER: User Router  │
├─────────────────────────────┤
│ 🎯 greeting                 │
└─────────────────────────────┘
```

### Tools Node

**Default:**
```
┌─────────────────────────────┐
│ TOOLS                       │
├─────────────────────────────┤
│ 🔧 codebase-search          │
│ 🔧 str-replace-editor       │
└─────────────────────────────┘
```

## Files Changed

1. **`electron/store/utils/node-colors.ts`**
   - Added `NODE_KIND_LABELS` mapping
   - Added `getNodeKindLabel()` helper
   - Added `formatNodeTitle()` helper

2. **`src/components/NodeOutputBox.tsx`**
   - Import `formatNodeTitle` function
   - Use `formatNodeTitle(nodeKind, nodeLabel)` for display title
   - Changed header to use `displayTitle` instead of raw `nodeLabel`

3. **`src/components/FlowNode/NodeHeader.tsx`**
   - Removed local `NODE_KIND_LABELS` constant
   - Import from shared `node-colors.ts` utility

## Benefits

1. **Consistency**: All node titles follow the same format across the application
2. **Clarity**: Users can immediately see both the node type and custom label
3. **Maintainability**: Single source of truth for node kind labels
4. **Extensibility**: Easy to add new node types - just update the mapping

## Future Enhancements

Consider:
1. Adding icons to node type labels (e.g., `💬 LLM REQUEST`)
2. Supporting custom formatting per node type
3. Adding tooltips with additional node information
4. Supporting markdown in node labels

