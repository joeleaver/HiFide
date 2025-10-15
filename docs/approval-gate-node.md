# Approval Gate Node

## Overview

The **Approval Gate** node is a control flow node that pauses execution and requires manual approval before allowing the flow to continue. This is essential for workflows that need human oversight before proceeding with potentially sensitive or costly operations.

## Icon & Color
- **Icon**: ✅
- **Color**: Red (#ef4444)
- **Category**: Control

## How It Works

When the flow execution reaches an Approval Gate node:

1. **Flow Pauses**: Execution stops at this node
2. **Status Updates**: The node shows "approval-required" status
3. **Waits for User**: The flow remains paused until the user takes action
4. **User Approves**: User clicks "Resume" in the debug controls
5. **Flow Continues**: Execution proceeds to the next node

If the approval requirement is disabled, the node shows "auto-approved" and execution continues immediately.

## Configuration

### Require Approval (Checkbox)
- **Default**: Unchecked (auto-approved)
- **When Checked**: Flow pauses and waits for manual approval
- **When Unchecked**: Flow continues automatically (no pause)

### How to Configure:
1. Click the Approval Gate node to expand it
2. Check/uncheck the "Require approval" checkbox
3. The node will show the current setting

## Use Cases

### 1. **Before Expensive Operations**
Pause before making costly API calls or LLM requests:

```
[User Input] → [Approval Gate] → [Expensive LLM Call] → [Response]
```

**Why**: Review the input and estimated cost before proceeding

### 2. **Before External Actions**
Pause before sending emails, posting to social media, or making database changes:

```
[Generate Email] → [Approval Gate] → [Send Email] → [Log Result]
```

**Why**: Review the generated content before it's sent

### 3. **Before Data Modifications**
Pause before updating or deleting data:

```
[Query Data] → [Generate Update] → [Approval Gate] → [Execute Update] → [Confirm]
```

**Why**: Verify the changes before they're applied

### 4. **Multi-Stage Workflows**
Add approval gates at key decision points:

```
[Draft] → [Approval Gate] → [Refine] → [Approval Gate] → [Publish]
```

**Why**: Human oversight at each stage of the process

### 5. **Budget Control**
Pause before exceeding budget thresholds:

```
[Budget Guard] → [Approval Gate] → [High-Cost Operation]
```

**Why**: Confirm you want to proceed despite budget concerns

## Session Context Recommendations

Approval gates work in any session context, but here are best practices:

### ✅ **Pre-Session** (Recommended for setup validation)
```
[Load Config] (pre-session)
     ↓
[Approval Gate] (pre-session) ← Review config before starting
     ↓
[Initialize Session] (session-init)
```

### ✅ **In-Session** (Recommended for conversation control)
```
[User Input] (session-init)
     ↓
[Generate Response] (in-session)
     ↓
[Approval Gate] (in-session) ← Review response before sending
     ↓
[Stream Response] (in-session)
```

### ✅ **Post-Session** (Recommended for cleanup confirmation)
```
[Session Complete] (in-session)
     ↓
[Approval Gate] (post-session) ← Confirm cleanup actions
     ↓
[Delete Temp Files] (post-session)
```

### ⚠️ **Out-of-Session** (Use with caution)
Out-of-session nodes run in parallel, so an approval gate here will pause that parallel branch but not the main flow. Only use if you specifically want to pause a parallel operation.

## How to Use

### Step 1: Add the Node
1. Open Flow Editor
2. Drag "Approval Gate" from the node palette
3. Place it where you want execution to pause

### Step 2: Configure
1. Click the node to expand its properties
2. Check "Require approval" to enable the gate
3. Optionally set the session context

### Step 3: Connect
Connect the approval gate between the nodes where you want to pause:
```
[Before Node] → [Approval Gate] → [After Node]
```

### Step 4: Run and Approve
1. Run the flow
2. When execution reaches the approval gate, it pauses
3. Review the execution log and current state
4. Click **Resume** in the debug controls to continue
5. Or click **Stop** to cancel the flow

## Visual Indicators

### Node Status
The approval gate node shows different statuses:

- **⏸ approval-required** (Yellow badge) - Waiting for approval
- **✓ auto-approved** (Green badge) - Approval not required, continuing
- **▶ RUNNING** (Status bar) - Flow is running
- **⏸ PAUSED** (Status bar) - Flow is paused at approval gate

### Execution Log
The debug panel shows approval gate events:

```
[approvalGate-1] approval-required
[Flow paused - waiting for approval]
[User clicked Resume]
[approvalGate-1] approved
[Continuing execution...]
```

## Example: Email Campaign Flow

Here's a complete example of using approval gates in an email campaign workflow:

```
[Load Recipients] (pre-session)
     ↓
[Approval Gate] (pre-session) ← Review recipient list
     ↓
[Generate Email Template] (session-init)
     ↓
[Personalize for Each Recipient] (in-session)
     ↓
[Approval Gate] (in-session) ← Review personalized emails
     ↓
[Send Emails] (in-session)
     ↓
[Log Results] (post-session)
     ↓
[Approval Gate] (post-session) ← Review results before cleanup
     ↓
[Archive Campaign] (post-session)
```

**Approval Points:**
1. **Pre-Session**: Verify the recipient list is correct
2. **In-Session**: Review the personalized emails before sending
3. **Post-Session**: Confirm results before archiving

## Debugging with Approval Gates

Approval gates are excellent for debugging:

### Inspect State
Pause execution to inspect:
- Current node outputs
- Session messages
- Execution log
- Variable values

### Step Through Flow
Use approval gates as manual breakpoints:
1. Add approval gates between nodes
2. Run the flow
3. Review state at each gate
4. Resume to continue to the next gate

### Test Branches
Pause before conditional branches to verify:
- Which path will be taken
- Input values for the condition
- Expected outputs

## Best Practices

### ✅ DO:
- Use approval gates before expensive operations
- Add approval gates before external actions (emails, API calls, database changes)
- Place approval gates at key decision points
- Use descriptive node labels (e.g., "Approve Email Send")
- Review the execution log before approving

### ❌ DON'T:
- Add too many approval gates (slows down workflow)
- Use approval gates in fully automated flows (defeats the purpose)
- Forget to check "Require approval" if you want the gate to pause
- Use approval gates in out-of-session nodes unless you understand parallel execution

## Troubleshooting

### Problem: Flow doesn't pause at approval gate
**Solution**: Make sure "Require approval" is checked in the node configuration

### Problem: Can't resume after approval gate
**Solution**: Click the "Resume" button in the debug controls (right panel)

### Problem: Flow pauses but I want it to auto-approve
**Solution**: Uncheck "Require approval" in the node configuration

### Problem: Approval gate in out-of-session node doesn't pause main flow
**Solution**: This is expected behavior. Out-of-session nodes run in parallel. Move the approval gate to an in-session node if you want to pause the main flow.

## Advanced: Conditional Approval

You can combine approval gates with other nodes for conditional approval:

```
[Budget Guard]
     ↓
[Check if over budget] (conditional)
     ↓
[If over budget] → [Approval Gate] → [Continue]
     ↓
[If under budget] → [Continue]
```

This way, approval is only required when certain conditions are met.

## Related Nodes

- **Budget Guard**: Monitor costs before approval
- **Error Detection**: Check for errors before approval
- **Conditional Nodes**: Route to approval gate based on conditions

## Summary

The Approval Gate node is a powerful control flow tool that:
- ✅ Pauses execution for human review
- ✅ Prevents unwanted automated actions
- ✅ Provides oversight for sensitive operations
- ✅ Helps with debugging and testing
- ✅ Works in any session context

Use it whenever you need human judgment before proceeding with an operation!

