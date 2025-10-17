# Node Label Persistence Fix

## Issue

Node labels (custom titles) were not being saved when saving flow profiles. When a user renamed a node and saved the flow, the custom label would be lost when the flow was reloaded.

## Root Cause

The serialization/deserialization logic in the flow profile system was not handling node labels:

1. **Serialization** (`serializeNode`): Did not extract or save the `label`/`labelBase` fields from node data
2. **Deserialization** (`deserializeNode`): Always set `label` and `labelBase` to the node ID, ignoring any saved custom labels

## Files Changed

### 1. `electron/services/flowProfiles.ts`

#### SerializedNode Interface
Added `label` field to the interface:

```typescript
export interface SerializedNode {
  id: string
  kind: string
  label?: string      // Custom node label (if different from id)
  config?: Record<string, any>
  position: { x: number; y: number }
  expanded?: boolean
}
```

#### serializeNode Function
Updated to extract and save the label:

```typescript
function serializeNode(node: Node): SerializedNode {
  const data = node.data as any
  const label = data?.labelBase || data?.label
  
  return {
    id: node.id,
    kind: data?.kind || node.id.split('-')[0],
    label: label !== node.id ? label : undefined, // Only save if different from id
    config: data?.config || {},
    position: node.position,
    expanded: data?.expanded || false,
  }
}
```

**Key points:**
- Extracts `labelBase` (preferred) or `label` from node data
- Only saves the label if it's different from the node ID (optimization)
- Falls back to `undefined` if label equals ID (saves storage space)

#### deserializeNode Function
Updated to restore the saved label:

```typescript
function deserializeNode(serialized: SerializedNode): Node {
  const label = serialized.label || serialized.id
  
  return {
    id: serialized.id,
    type: 'hifiNode',
    position: serialized.position,
    data: {
      kind: serialized.kind,
      label: label,
      labelBase: label,
      config: serialized.config || {},
      expanded: serialized.expanded || false,
      bp: false,
      onToggleBp: () => {},
    },
  }
}
```

**Key points:**
- Uses saved `label` if available, otherwise falls back to node ID
- Sets both `label` and `labelBase` to the same value for consistency

### 2. `electron/store/slices/flowEditor.slice.ts`

#### feExportFlow Action
Updated node serialization to include labels:

```typescript
nodes: feNodes.map((n) => {
  const data = n.data as any
  const label = data?.labelBase || data?.label
  return {
    id: n.id,
    kind: data?.kind || n.id.split('-')[0],
    label: label !== n.id ? label : undefined, // Only save if different from id
    config: data?.config || {},
    position: n.position,
    expanded: data?.expanded || false,
  }
})
```

#### feStartPeriodicSave Action
Updated state snapshot to include labels for change detection:

```typescript
nodes: feNodes.map(n => {
  const data = n.data as any
  return {
    id: n.id,
    kind: data?.kind,
    label: data?.labelBase || data?.label,
    config: data?.config,
    position: n.position,
    expanded: data?.expanded
  }
})
```

**Note:** This ensures that label changes trigger the "unsaved changes" detection.

## How Labels Work in the System

### Label Fields
Each node has two label-related fields in its `data`:

1. **`labelBase`**: The canonical custom label set by the user
2. **`label`**: The display label (may be modified during execution for status display)

When saving, we prefer `labelBase` as it represents the user's intended label.

### Label Setting
Labels are set via the `feSetNodeLabel` action:

```typescript
feSetNodeLabel: ({ id, label }: { id: string; label: string }) => {
  const updatedNodes = get().feNodes.map((n) => 
    (n.id === id ? { ...n, data: { ...(n.data as any), labelBase: label, label } } : n)
  )
  set({ feNodes: updatedNodes })
}
```

This is called from the `NodeHeader` component when the user edits the node title.

## Testing

To verify the fix:

1. **Create a new flow** or open an existing one
2. **Rename a node** by clicking on its title and typing a new name
3. **Save the flow** (Ctrl+S or via menu)
4. **Reload the flow** (close and reopen, or load a different flow then reload)
5. **Verify** that the custom node label is preserved

## Backward Compatibility

The fix is backward compatible:

- **Old profiles without labels**: Will use node ID as label (existing behavior)
- **New profiles with labels**: Will save and restore custom labels
- **Mixed scenarios**: Works correctly in all cases

The `label` field is optional in `SerializedNode`, so old profiles that don't have it will continue to work.

## Related Code

- **Node label editing**: `src/components/FlowNode/NodeHeader.tsx`
- **Label display**: `src/components/FlowNode/index.tsx`
- **Store action**: `electron/store/slices/flowEditor.slice.ts` (`feSetNodeLabel`)
- **Serialization**: `electron/services/flowProfiles.ts`

## Future Improvements

Consider:
1. Adding label validation (max length, allowed characters)
2. Supporting label templates or auto-naming patterns
3. Adding a "reset to default" option to restore the node ID as the label

