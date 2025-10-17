# Connection Colors - Standardization

## Overview

Connection colors are now centralized in `electron/store/utils/connection-colors.ts` to ensure consistency across all nodes and edges in the flow editor.

## Color Scheme

We have three standardized connection types:

| Type | Color | Hex Code | Usage |
|------|-------|----------|-------|
| **Context** | Purple | `#9b59b6` | Context/conversation flow between nodes |
| **Data** | Green | `#2ecc71` | Data/result flow between nodes |
| **Tools** | Orange | `#f97316` | Tools connections (e.g., from Tools node to LLM nodes) |
| **Default** | Gray | `#666` | Fallback for unknown connection types |
| **Selected** | Blue | `#007acc` | Selected edges in the editor |

## Architecture

### Centralized Configuration

All connection colors are defined in a single source of truth:

```typescript
// electron/store/utils/connection-colors.ts
export const CONNECTION_COLORS = {
  context: '#9b59b6',  // Purple
  data: '#2ecc71',     // Green
  tools: '#f97316',    // Orange
  default: '#666',     // Gray
  selected: '#007acc', // Blue
} as const
```

### Helper Functions

Two helper functions are provided:

1. **`getConnectionColor(type)`** - Get color by connection type name
2. **`getConnectionColorFromHandles(sourceHandle, targetHandle)`** - Auto-detect connection type from handle names

### Usage in Components

#### Node Handles (`src/components/FlowNode/NodeHandles.tsx`)

All handle definitions now use `CONNECTION_COLORS`:

```typescript
import { CONNECTION_COLORS } from '../../../electron/store/utils/connection-colors'

// Context handles
inputs.push({ id: 'context', label: 'Context In', color: CONNECTION_COLORS.context })
outputs.push({ id: 'context', label: 'Context Out', color: CONNECTION_COLORS.context })

// Data handles
inputs.push({ id: 'data', label: 'Data In', color: CONNECTION_COLORS.data })
outputs.push({ id: 'data', label: 'Data Out', color: CONNECTION_COLORS.data })

// Tools handles
inputs.push({ id: 'tools', label: 'Tools', color: CONNECTION_COLORS.tools })
outputs.push({ id: 'tools', label: 'Tools', color: CONNECTION_COLORS.tools })
```

#### Edge Styling (`src/components/FlowCanvasPanel.tsx`)

Edge colors are determined automatically using `getConnectionColorFromHandles()`:

```typescript
import { getConnectionColorFromHandles, CONNECTION_COLORS } from '../../electron/store/utils/connection-colors'

// When creating new edges
const color = getConnectionColorFromHandles(sourceHandle, targetHandle)

// When styling existing edges
const styledEdges = edges.map(edge => {
  const color = getConnectionColorFromHandles(edge.sourceHandle, edge.targetHandle)
  return {
    ...edge,
    style: edge.selected
      ? { stroke: CONNECTION_COLORS.selected, strokeWidth: 3 }
      : { stroke: color, strokeWidth: 2 }
  }
})
```

## Bug Fixes

### Intent Router Data Outputs

**Issue**: Intent Router node was using orange (`#f39c12`) for its data outputs instead of the standard green.

**Fix**: Updated `NodeHandles.tsx` line 98 to use `CONNECTION_COLORS.data`:

```typescript
// Before
outputs.push({ id: `${intent}-data`, label: `${intent} Data`, color: '#f39c12' })

// After
outputs.push({ id: `${intent}-data`, label: `${intent} Data`, color: CONNECTION_COLORS.data })
```

## Benefits

1. **Single Source of Truth**: All colors defined in one place
2. **Consistency**: All nodes use the same colors for the same connection types
3. **Maintainability**: Easy to update colors globally
4. **Type Safety**: TypeScript ensures correct color usage
5. **Auto-Detection**: Edge colors automatically determined from handle types

## Migration Guide

When adding new nodes or connection types:

1. Import the constants:
   ```typescript
   import { CONNECTION_COLORS } from '../../../electron/store/utils/connection-colors'
   ```

2. Use the appropriate color constant:
   - Context connections: `CONNECTION_COLORS.context`
   - Data connections: `CONNECTION_COLORS.data`
   - Tools connections: `CONNECTION_COLORS.tools`

3. Never hardcode color values - always use the centralized constants

## Related Files

- `electron/store/utils/connection-colors.ts` - Color definitions
- `src/components/FlowNode/NodeHandles.tsx` - Handle rendering
- `src/components/FlowCanvasPanel.tsx` - Edge styling
- `electron/store/utils/node-colors.ts` - Node colors (separate system)

