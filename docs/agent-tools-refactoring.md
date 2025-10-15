# Agent Tools Refactoring

## Overview

Successfully refactored all 24 agent tools from a monolithic 1000+ line array in `electron/main.ts` into individual, self-contained files organized by category.

## What Changed

### Before
- All 24 agent tools defined inline in `electron/main.ts` (lines 135-1161)
- Helper functions scattered throughout main.ts
- Adding a new tool required editing the massive array
- Hard to find and maintain individual tools

### After
- Each tool in its own file with complete definition (metadata + implementation)
- Shared utilities extracted to `electron/tools/utils.ts`
- Tools organized by category in subdirectories
- `electron/tools/index.ts` aggregates all tools
- `electron/main.ts` reduced from 1194 lines to 95 lines!

## Directory Structure

```
electron/tools/
├── index.ts              # Main registry - imports and exports all tools
├── utils.ts              # Shared utilities (resolveWithinWorkspace, atomicWrite, etc.)
├── astGrep.ts            # AST grep search and rewrite functions
├── agent/                # Self-regulation tools (3 tools)
│   ├── assessTask.ts
│   ├── checkResources.ts
│   └── summarizeProgress.ts
├── fs/                   # Filesystem tools (14 tools)
│   ├── readFile.ts
│   ├── readDir.ts
│   ├── writeFile.ts
│   ├── createDir.ts
│   ├── deleteDir.ts
│   ├── deleteFile.ts
│   ├── exists.ts
│   ├── stat.ts
│   ├── appendFile.ts
│   ├── move.ts
│   ├── copy.ts
│   ├── remove.ts
│   ├── truncateFile.ts
│   └── truncateDir.ts
├── edits/                # Edit tools (1 tool)
│   └── apply.ts
├── index/                # Index tools (1 tool)
│   └── search.ts
├── terminal/             # Terminal tools (4 tools)
│   ├── exec.ts
│   ├── sessionSearchOutput.ts
│   ├── sessionTail.ts
│   └── sessionRestart.ts
└── code/                 # Code tools (2 tools)
    ├── searchAst.ts
    └── applyEditsTargeted.ts
```

## Tool Categories

### Agent Tools (3)
Self-regulation tools that allow the agent to manage its own resources:
- `agent.assess_task` - Analyze task scope and plan approach
- `agent.check_resources` - Check token usage and remaining budget
- `agent.summarize_progress` - Summarize progress to compress context

### Filesystem Tools (14)
Basic file and directory operations:
- `fs.read_file` - Read UTF-8 text file
- `fs.read_dir` - List directory contents
- `fs.write_file` - Write/overwrite file
- `fs.create_dir` - Create directory
- `fs.delete_dir` - Delete directory
- `fs.delete_file` - Delete file
- `fs.exists` - Check if path exists
- `fs.stat` - Get file/directory stats
- `fs.append_file` - Append to file
- `fs.move` - Move/rename file or directory
- `fs.copy` - Copy file or directory
- `fs.remove` - Remove file or directory (alias for delete)
- `fs.truncate_file` - Truncate file to specific size
- `fs.truncate_dir` - Truncate directory (remove all contents)

### Edit Tools (1)
- `edits.apply` - Apply file edits with verification

### Index Tools (1)
- `index.search` - Search codebase index

### Terminal Tools (4)
Terminal session management and command execution. All commands execute in a persistent PTY session that is visible in the agent's terminal panel UI. Sessions are automatically created on first use and cleaned up when the agent request completes.
- `terminal.exec` - Execute command in persistent session (auto-creates session if needed, output visible in UI)
- `terminal.session_search_output` - Search session output
- `terminal.session_tail` - Get last part of session buffer
- `terminal.session_restart` - Restart terminal session

### Code Tools (2)
Advanced code manipulation:
- `code.search_ast` - Structural AST search using @ast-grep/napi
- `code.apply_edits_targeted` - Apply targeted edits (text, AST rewrites, advanced text edits)

## File Structure Pattern

Each tool file follows this pattern:

```typescript
import type { AgentTool } from '../../providers/provider'
import { /* shared utilities */ } from '../utils'

export const toolNameTool: AgentTool = {
  name: 'category.tool_name',
  description: 'Tool description',
  parameters: {
    type: 'object',
    properties: { /* ... */ },
    required: [/* ... */],
    additionalProperties: false,
  },
  run: async (args, meta) => {
    // Implementation
  }
}
```

## Shared Utilities

Extracted to `electron/tools/utils.ts`:
- `resolveWithinWorkspace(path)` - Resolve path within workspace (security)
- `atomicWrite(filePath, content)` - Atomic file write
- `logEvent(sessionId, type, payload)` - Event logging
- `isRiskyCommand(cmd)` - Check if command is risky
- `redactOutput(input)` - Redact sensitive data from output
- `applyFileEditsInternal(edits, opts)` - Apply file edits

## Benefits

1. **Self-contained**: Each tool file has everything about that tool
2. **Easy to add new tools**: Just create one file + one import line in index.ts
3. **Better maintainability**: Logic and metadata live together
4. **Type-safe**: Full TypeScript support maintained
5. **No breaking changes**: All existing code continues to work
6. **Cleaner main.ts**: Reduced from 1194 lines to 95 lines
7. **Better organization**: Tools grouped by category
8. **Easier testing**: Each tool can be tested independently

## How to Add a New Tool

1. Create a new file in the appropriate category directory (e.g., `electron/tools/fs/newTool.ts`)
2. Export a tool following the pattern above
3. Add import to `electron/tools/index.ts`
4. Add tool to the `agentTools` array in `index.ts`

Example:

```typescript
// electron/tools/fs/newTool.ts
import type { AgentTool } from '../../providers/provider'

export const newTool: AgentTool = {
  name: 'fs.new_tool',
  description: 'Does something new',
  parameters: {
    type: 'object',
    properties: { /* ... */ },
    required: [],
    additionalProperties: false,
  },
  run: async (args) => {
    // Implementation
    return { ok: true }
  }
}
```

```typescript
// electron/tools/index.ts
import { newTool } from './fs/newTool'

export const agentTools: AgentTool[] = [
  // ... existing tools ...
  newTool,
]
```

## Files Modified

- `electron/main.ts` - Removed tool definitions, now imports from `./tools`
- `electron/tools/index.ts` - Created main registry
- `electron/tools/utils.ts` - Created shared utilities
- `electron/tools/astGrep.ts` - Moved AST grep functions
- 24 individual tool files created

## Files Deleted

None - this was a pure refactoring with no functionality removed.

## Testing

All TypeScript checks pass with no errors. The refactoring maintains 100% backward compatibility.

## Related Documentation

- `docs/flow-node-structure.md` - Similar refactoring pattern for flow nodes
- `docs/flowCache-removal.md` - Previous cleanup work

