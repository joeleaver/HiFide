# Node Configuration Architecture

## Overview

This document describes how node configuration is stored and accessed throughout the Flow Editor system.

## Single Source of Truth

**All node configuration is stored in `node.data.config`**

This is the ONLY place where node-specific configuration should be stored. There is no duplication.

## Data Structure

### In the UI (ReactFlow)

```typescript
{
  id: 'approvalGate-1234567890',
  type: 'hifiNode',
  position: { x: 100, y: 200 },
  data: {
    kind: 'approvalGate',
    label: 'Approval Gate',
    labelBase: 'Approval Gate',
    bp: false,
    onToggleBp: (nodeId: string) => void,
    expanded: false,  // UI state for expand/collapse
    config: {
      // Node-specific configuration
      sessionContext: 'in-session',
      joinStrategy: 'last',
      requireApproval: true,
      // ... other node-specific settings
    }
  }
}
```

### In Flow Execution (IPC)

When the flow is executed, the flow definition is sent to the backend:

```typescript
{
  flowDef: {
    id: 'editor-current',
    nodes: [
      {
        id: 'approvalGate-1234567890',
        kind: 'approvalGate',
        config: {
          sessionContext: 'in-session',
          joinStrategy: 'last',
          requireApproval: true,
          // ... other settings
        }
      }
    ],
    edges: [...]
  }
}
```

## Configuration Access Patterns

### In the UI (FlowEditorView.tsx)

**Reading configuration:**
```typescript
const config = data?.config || {}
const requireApproval = config.requireApproval
const sessionContext = config.sessionContext || 'in-session'
```

**Writing configuration:**
```typescript
const patchNodeConfig = useAppStore((s) => s.fePatchNodeConfig)

// Update a single property
patchNodeConfig(nodeId, { requireApproval: true })

// Update multiple properties
patchNodeConfig(nodeId, { 
  sessionContext: 'pre-session',
  joinStrategy: 'concat'
})
```

### In the Execution Engine (electron/ipc/flows.ts)

**Reading configuration:**
```typescript
// Helper function (single source of truth)
const getNodeConfig = (nodeId: string): any => {
  const node = def.nodes.find(n => n.id === nodeId)
  return (node as any)?.config || {}
}

// Usage in node execution
const config = getNodeConfig(nodeId)
const requireApproval = config.requireApproval ?? false
const sessionContext = config.sessionContext || 'in-session'
```

## Configuration Properties by Node Type

### All Nodes (Common)

```typescript
{
  sessionContext?: 'pre-session' | 'session-init' | 'in-session' | 'out-of-session' | 'post-session',
  joinStrategy?: 'first' | 'last' | 'concat'
}
```

### Approval Gate

```typescript
{
  requireApproval?: boolean  // Default: false
}
```

### LLM Message

```typescript
{
  retryAttempts?: number,      // Default: 1
  retryBackoffMs?: number,     // Default: 0
  cacheEnabled?: boolean,      // Default: false
  cacheTtlMs?: number          // Default: 2 hours
}
```

### Redactor

```typescript
{
  enabled?: boolean,           // Default: true
  ruleEmails?: boolean,        // Default: false
  ruleApiKeys?: boolean,       // Default: false
  ruleAwsKeys?: boolean,       // Default: false
  ruleNumbers16?: boolean      // Default: false
}
```

### Budget Guard

```typescript
{
  budgetUSD?: number,          // Default: undefined
  blockOnExceed?: boolean      // Default: false
}
```

### Error Detection

```typescript
{
  enabled?: boolean,           // Default: true
  patterns?: string[],         // Default: []
  blockOnFlag?: boolean        // Default: false
}
```

## Historical Context: Why We Removed nodePolicies

### The Problem

Previously, configuration was duplicated in two places:

1. **`flowDef.nodes[i].config`** - The node's configuration
2. **`args.nodePolicies[nodeId]`** - A duplicate copy of the same configuration

This was created in `flowEditor.slice.ts`:
```typescript
// OLD CODE (removed)
const nodePolicies = Object.fromEntries(
  get().feNodes.map((n) => [
    n.id, 
    { kind: (n.data as any)?.kind, ...(n.data as any)?.config }
  ])
)
```

The execution engine would then check BOTH places:
```typescript
// OLD CODE (removed)
const ctx = (node as any)?.config?.sessionContext || (args.nodePolicies?.[nodeId]?.sessionContext)
```

### The Solution

We eliminated `nodePolicies` entirely and now:

1. **Store** configuration only in `node.data.config`
2. **Send** configuration only in `flowDef.nodes[i].config`
3. **Read** configuration only from `node.config` using `getNodeConfig(nodeId)`

### Benefits

✅ **Single source of truth** - No confusion about which value is correct  
✅ **Simpler code** - No need to check multiple places  
✅ **Less data transfer** - Don't send duplicate configuration over IPC  
✅ **Easier debugging** - Only one place to look for configuration  
✅ **Clearer intent** - Configuration belongs to the node  

## Best Practices

### ✅ DO:

1. **Store all node-specific configuration in `node.data.config`**
   ```typescript
   patchNodeConfig(nodeId, { requireApproval: true })
   ```

2. **Use `getNodeConfig(nodeId)` in the execution engine**
   ```typescript
   const config = getNodeConfig(nodeId)
   const value = config.propertyName ?? defaultValue
   ```

3. **Provide sensible defaults**
   ```typescript
   const enabled = config.enabled ?? true
   ```

4. **Use optional chaining and nullish coalescing**
   ```typescript
   const sessionContext = config.sessionContext ?? 'in-session'
   ```

### ❌ DON'T:

1. **Don't create duplicate configuration storage**
   ```typescript
   // DON'T DO THIS
   const nodePolicies = { ... }
   ```

2. **Don't check multiple places for the same value**
   ```typescript
   // DON'T DO THIS
   const value = config.value || policies.value || default
   ```

3. **Don't store configuration in global state**
   ```typescript
   // DON'T DO THIS (unless it's truly global)
   const globalConfig = { requireApproval: true }
   ```

4. **Don't pass configuration separately from the node**
   ```typescript
   // DON'T DO THIS
   runNode(node, config)  // Config should be in node.config
   ```

## Migration Guide

If you're adding a new configuration property:

1. **Add it to the UI** in `FlowEditorView.tsx`:
   ```typescript
   <input
     checked={!!config.myNewProperty}
     onChange={(e) => patchNodeConfig(id, { myNewProperty: e.target.checked })}
   />
   ```

2. **Read it in the execution engine** in `electron/ipc/flows.ts`:
   ```typescript
   const config = getNodeConfig(nodeId)
   const myValue = config.myNewProperty ?? defaultValue
   ```

3. **Document it** in this file under "Configuration Properties by Node Type"

That's it! No need to update multiple places or create duplicate storage.

## Summary

- **Storage**: `node.data.config` (UI) → `flowDef.nodes[i].config` (IPC)
- **Access**: `getNodeConfig(nodeId)` in execution engine
- **Pattern**: Single source of truth, no duplication
- **Result**: Simpler, clearer, more maintainable code

All node configuration flows through a single, well-defined path from the UI to the execution engine.

