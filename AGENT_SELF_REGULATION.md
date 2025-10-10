# Agent Self-Regulation Implementation

## Overview

This document describes the agent self-regulation system implemented to prevent excessive token usage during complex operations like codebase audits.

## Problem

Previously, the agent could use 500K+ tokens during a codebase audit because:
1. **Unbounded loops**: No iteration limits in provider agent loops
2. **Context accumulation**: Full conversation history sent with every API request
3. **Automatic context injection**: Project context + index results added on every turn
4. **No resource tracking**: No token budget or conversation pruning

## Solution: Agent-Driven Self-Regulation

Instead of hardcoded heuristics, we give the agent **three new tools** to manage its own resources:

### 1. `agent.assess_task`
**Purpose**: Plan upfront and understand resource budget

**When to use**: FIRST, before taking any other actions

**Parameters**:
- `task_type`: simple_query | file_edit | multi_file_refactor | codebase_audit | exploration
- `estimated_files`: How many files will likely be examined
- `estimated_iterations`: How many tool-calling rounds estimated
- `strategy`: Brief description of approach (1-2 sentences)

**Returns**:
- `token_budget`: Allocated tokens based on task type and scope
- `max_iterations`: Maximum tool-calling iterations allowed
- `guidance`: Recommendation message

**Budget Calculation**:
```typescript
Base budgets:
- simple_query: 10K tokens, 3 iterations
- file_edit: 30K tokens, 8 iterations
- multi_file_refactor: 60K tokens, 15 iterations
- codebase_audit: 80K tokens, 20 iterations
- exploration: 40K tokens, 10 iterations

Adjusted by file count (up to 2x multiplier)
```

### 2. `agent.check_resources`
**Purpose**: Monitor token/iteration usage during execution

**When to use**: Periodically (every 3-5 tool calls)

**Parameters**: None

**Returns**:
- `tokens_used`, `tokens_budget`, `tokens_remaining`
- `percentage_used`
- `iterations_used`, `iterations_max`, `iterations_remaining`
- `recommendation`: Intelligent guidance based on usage level
  - `>80% used`: "WARNING: Low on resources. Summarize and wrap up."
  - `>50% used`: "CAUTION: Monitor usage carefully."
  - `<50% used`: "Resources healthy, continue."

### 3. `agent.summarize_progress`
**Purpose**: Compress conversation history to save tokens

**When to use**: When context grows (>10 tool calls) or resources running low

**Parameters**:
- `key_findings`: List of key findings so far
- `files_examined`: Files already read (to avoid re-reading)
- `next_steps`: What still needs investigation

**Effect**: 
- Stores summary in session state
- Triggers conversation pruning (keeps system message + summary + last 5 messages)
- Discards verbose tool outputs in the middle

## Implementation Details

### Session State Management
```typescript
interface AgentSessionState {
  requestId: string
  assessment: TaskAssessment | null
  cumulativeTokens: number
  iterationCount: number
  exploredItems: Map<string, ExploredItem>
  summaries: ProgressSummary[]
  startTime: number
  lastActivity: number
}
```

Stored in `Map<requestId, AgentSessionState>` with automatic cleanup after 1 hour of inactivity.

### Provider Loop Updates

**Anthropic & OpenAI providers now**:
1. Track cumulative tokens across all turns
2. Enforce hard limit of 50 iterations (safety)
3. Pass `toolMeta: { requestId }` to all tool executions
4. Detect `_meta.trigger_pruning` in tool results
5. Call `pruneConversation()` when agent requests it

**Conversation Pruning**:
```typescript
function pruneConversation(summary: ProgressSummary) {
  // Keep: system message + formatted summary + last 5 messages
  // Discard: verbose tool outputs in the middle
  conv = [summaryMsg, ...conv.slice(-5)]
}
```

### System Prompt Updates

Both `llm:auto` and `llm:agentStart` handlers now include:

```
RESOURCE MANAGEMENT:
1. ALWAYS call agent.assess_task FIRST to understand your resource budget
2. Call agent.check_resources periodically to monitor your token/iteration usage
3. Call agent.summarize_progress when context grows (>10 tool calls) to compress conversation history
4. Stay within your allocated token budget and iteration limits

Be efficient: avoid redundant operations, reuse information you've already gathered, and compress context when needed.
```

## Expected Behavior

### Example: Codebase Audit

**Before** (500K+ tokens):
1. Agent starts reading files
2. Reads 50+ files without planning
3. Context grows unbounded
4. No awareness of token usage
5. Eventually hits API limits or runs out of budget

**After** (50-80K tokens):
1. Agent calls `agent.assess_task` → gets 80K budget, 20 iterations
2. Agent uses `index.search` to find relevant files
3. Agent reads 5-10 most relevant files
4. After 10 tool calls, agent calls `agent.check_resources` → sees 40% used
5. Agent calls `agent.summarize_progress` → context compressed
6. Agent continues efficiently with compressed context
7. Agent provides findings within budget

## Testing

To test the implementation:

1. **Start the app**: `pnpm dev`
2. **Open Agent screen**
3. **Ask**: "Audit this codebase for potential issues"
4. **Verify**:
   - Agent calls `agent.assess_task` first
   - Agent periodically calls `agent.check_resources`
   - Agent calls `agent.summarize_progress` when context grows
   - Token usage stays within 80K tokens
   - Agent completes within 20 iterations

## Benefits

1. **Less Brittle**: Agent adapts to new scenarios without code changes
2. **Self-Improving**: Agent learns from resource constraints
3. **Transparent**: User can see agent's planning and resource management
4. **Flexible**: Different agents can have different strategies
5. **Debuggable**: Agent's reasoning visible in tool calls

## Files Modified

- `electron/agent/types.ts` - New type definitions and helper functions
- `electron/providers/provider.ts` - Updated AgentTool interface to accept metadata
- `electron/providers/anthropic.ts` - Added pruning, token tracking, iteration limits
- `electron/providers/openai.ts` - Added pruning, token tracking, iteration limits
- `electron/main.ts` - Added three agent tools, session state management, updated system prompts

## Future Enhancements

1. **Adaptive budgets**: Learn from past tasks to adjust budgets
2. **Cost estimation**: Show estimated cost before expensive operations
3. **User confirmation**: Prompt user before operations >100K tokens
4. **Redundancy detection**: Track explored items to avoid re-reading files
5. **Specialized agents**: Different system prompts for different task types

