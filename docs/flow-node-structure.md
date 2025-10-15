# Flow Node Structure

## Overview

Each flow node is now self-contained in its own file with both implementation and metadata. This makes the codebase more maintainable and easier to extend.

## File Structure

```
electron/ipc/flows-v2/nodes/
├── index.ts                    # Node registry (imports all nodes)
├── chat.ts                     # Chat node implementation + metadata
├── defaultContextStart.ts      # Entry point node implementation + metadata
├── userInput.ts                # User input node implementation + metadata
├── tools.ts                    # Tools provider node implementation + metadata
├── manualInput.ts              # Manual input node implementation + metadata
└── intentRouter.ts             # Intent router node implementation + metadata
```

## Node File Template

Each node file should follow this structure:

```typescript
/**
 * {nodeName} node
 *
 * {Description of what this node does}
 *
 * Inputs:
 * - {inputName}: {description}
 *
 * Outputs:
 * - {outputName}: {description}
 *
 * Config:
 * - {configKey}: {description}
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'
// ... other imports

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy, // 'any' | 'all' | 'custom'
  description: 'Brief description of what this node does'
}

/**
 * Node implementation
 */
export const {nodeName}Node: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // Implementation here
  
  return {
    context: contextIn,
    data: someData,
    status: 'success'
  }
}
```

## Execution Policies

- **`'any'`** (default): Execute when ANY input is ready (OR logic)
  - Used by most nodes
  - Example: chat node can execute with just a message, tools are optional

- **`'all'`**: Execute when ALL inputs are ready (AND logic)
  - Used for join/collect nodes that need to wait for multiple inputs
  - Example: parallelJoin node that waits for all parallel branches

- **`'custom'`**: Node function decides when it's ready via canExecute callback
  - For advanced use cases with complex readiness logic

## Adding a New Node

### Step 1: Create the node file

Create a new file in `electron/ipc/flows-v2/nodes/{nodeName}.ts`:

```typescript
import type { NodeFunction, NodeExecutionPolicy } from '../types'

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Your node description'
}

/**
 * Node implementation
 */
export const yourNodeName: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // Your implementation
  
  return {
    context: contextIn,
    data: yourData,
    status: 'success'
  }
}
```

### Step 2: Register in index.ts

Add your node to `electron/ipc/flows-v2/nodes/index.ts`:

```typescript
// 1. Import the node
import { yourNodeName, metadata as yourNodeMetadata } from './yourNode'

// 2. Add to NODE_REGISTRY
const NODE_REGISTRY: Record<string, NodeMetadata> = {
  // ... existing nodes
  yourNode: {
    fn: yourNodeName,
    ...yourNodeMetadata
  },
}
```

### Step 3: Add to type definitions (if needed)

If you want TypeScript autocomplete for your node type, add it to `electron/app/flows/types.ts`:

```typescript
export type NodeKind =
  | 'defaultContextStart'
  | 'userMessage'
  // ... existing types
  | 'yourNode'
  | (string & {})
```

That's it! Your node is now ready to use in flows.

## Benefits of This Structure

1. **Self-contained**: Each node file contains everything about that node
2. **Easy to add**: Adding a new node is just creating one file + one import
3. **Easy to maintain**: Node logic and metadata live together
4. **Type-safe**: Full TypeScript support with proper types
5. **Discoverable**: Easy to find and understand what each node does

## Example: Chat Node

<augment_code_snippet path="electron/ipc/flows-v2/nodes/chat.ts" mode="EXCERPT">
````typescript
/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Sends a message to the LLM and returns the response...'
}

/**
 * Node implementation
 */
export const chatNode: NodeFunction = async (contextIn, dataIn, inputs, config) => {
  // Implementation...
}
````
</augment_code_snippet>

## Node Input/Output Patterns

### Context Flow
- **Input**: `contextIn` - Execution context from predecessor
- **Output**: `context` - Updated or pass-through context
- Flows through context edges (top handle in UI)

### Data Flow
- **Input**: `dataIn` - Simple data value from predecessor
- **Output**: `data` - Data produced by this node
- Flows through data edges (right handle in UI)

### Special Inputs
- **`inputs.tools`**: Array of tool definitions (from tools node)
- **`inputs.{custom}`**: Any custom input from other nodes

### Config
- Node-specific configuration set in the UI
- Accessed via `config` parameter
- Example: `config.message` for manualInput node

