# Flow Status Cleanup

## Overview

Cleaned up and standardized flow status values across the entire codebase. Changed `'idle'` to `'stopped'` for clarity and removed the unused `'paused'` status.

## Flow Status Values

The application now uses exactly **three** flow status values:

```typescript
export type FlowStatus = 'stopped' | 'running' | 'waitingForInput'
```

### Status Meanings

- **`'stopped'`** - Flow is not running (initial state, or after completion/stop)
- **`'running'`** - Flow is actively executing nodes
- **`'waitingForInput'`** - Flow is paused at a `userInput` node, waiting for user to provide input

## Changes Made

### 1. Type Definitions

**`electron/store/slices/flowEditor.slice.ts`**
```typescript
// Before
export type FlowStatus = 'idle' | 'running' | 'paused' | 'waitingForInput'

// After
export type FlowStatus = 'stopped' | 'running' | 'waitingForInput'
```

**`electron/store/types.ts`** (Session.flowState)
```typescript
// Before
flowState?: {
  requestId: string
  status: 'idle' | 'running' | 'paused' | 'error'
  pausedAt?: number
  pausedNodeId?: string
}

// After
flowState?: {
  requestId: string
  status: 'stopped' | 'running' | 'waitingForInput'
  pausedAt?: number   // Timestamp when flow was paused (waitingForInput)
  pausedNodeId?: string  // Which node the flow is paused at (waitingForInput)
}
```

### 2. Component Updates

**`src/components/StatusBar.tsx`**
```typescript
// Before
color: feStatus === 'paused' || feStatus === 'waitingForInput' ? '#f59f00' : '#4caf50'
{feStatus === 'paused' ? '⏸ PAUSED' : feStatus === 'waitingForInput' ? '⏸ WAITING' : '▶ RUNNING'}

// After
color: feStatus === 'waitingForInput' ? '#f59f00' : '#4caf50'
{feStatus === 'waitingForInput' ? '⏸ WAITING' : '▶ RUNNING'}
```

**`src/components/FlowCanvasPanel.tsx`**
```typescript
// Before
{(status === 'paused' || status === 'waitingForInput') && (
  <Badge size="sm" color="yellow">
    {status === 'waitingForInput' ? 'Waiting' : 'Paused'}
    {pausedNode ? ` at ${pausedNode}` : ''}
  </Badge>
)}

// After
{status === 'waitingForInput' && (
  <Badge size="sm" color="yellow">
    Waiting{pausedNode ? ` at ${pausedNode}` : ''}
  </Badge>
)}
```

**`src/components/FlowStatusIndicator.tsx`**
```typescript
type FlowStatus = 'stopped' | 'running' | 'waitingForInput'

const config: Record<Exclude<FlowStatus, 'stopped'>, { icon: JSX.Element; text: string; color: string }> = {
  running: {
    icon: <Loader size={18} color="#4dabf7" />,
    text: 'Flow running...',
    color: '#4dabf7',
  },
  waitingForInput: {
    icon: <IconClock size={18} color="#4ade80" />,
    text: 'Waiting for user input',
    color: '#4ade80',
  },
}
```

## Status Transitions

### Normal Flow Execution

```
stopped → running → stopped
```

1. User starts flow: `'stopped'` → `'running'`
2. Flow completes: `'running'` → `'stopped'`
3. User stops flow: `'running'` → `'stopped'`

### Flow with User Input

```
stopped → running → waitingForInput → running → stopped
```

1. User starts flow: `'stopped'` → `'running'`
2. Flow reaches `userInput` node: `'running'` → `'waitingForInput'`
3. User provides input: `'waitingForInput'` → `'running'`
4. Flow completes: `'running'` → `'stopped'`

## Visual Indicators

### SessionPane (Chat View)

When flow is not streaming text, shows status indicator:

- **Running**: 🔵 Spinner + "Flow running..." (blue)
- **Waiting**: 🕐 Clock icon + "Waiting for user input" (green)
- **Stopped**: No indicator shown

### StatusBar (Bottom Right)

When flow is active:

- **Running**: `▶ RUNNING` (green)
- **Waiting**: `⏸ WAITING` (orange/yellow)
- **Stopped**: No status shown

### FlowCanvasPanel (Flow Editor)

When flow is active:

- **Running**: Green badge "Running"
- **Waiting**: Yellow badge "Waiting at {nodeId}"
- **Stopped**: "Restart" button shown

## Benefits

1. **Consistency**: All components use the same three status values
2. **Clarity**: `'stopped'` is more intuitive than `'idle'`; status names clearly indicate what's happening
3. **Type Safety**: TypeScript enforces correct status values
4. **Simplicity**: Removed unused 'paused' status that was never set
5. **Maintainability**: Single source of truth for status values

## Related Components

- `FlowStatusIndicator` - Unified status display component
- `StatusBar` - Shows flow status in bottom bar
- `FlowCanvasPanel` - Shows flow status in editor
- `SessionPane` - Shows flow status in chat view
- `flowEditor.slice.ts` - Manages flow execution state
- `types.ts` - Defines Session.flowState type

## Notes

- The `'waitingForInput'` status is set when a `userInput` node pauses execution
- The `fePausedNode` field tracks which node is waiting for input
- When user provides input via `feResume()`, status changes back to `'running'`
- When flow completes or is stopped, status changes to `'stopped'`
- Initial state is `'stopped'` (not running)

