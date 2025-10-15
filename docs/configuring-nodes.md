# How to Configure Nodes in the Flow Editor

## Quick Start

**To configure any node:**
1. **Click on the node header** (the colored bar at the top)
2. The node will expand to show configuration options
3. Make your changes
4. Click the header again to collapse

## Visual Indicators

### Collapsed Node
When a node is collapsed, you'll see:
- **▶ Arrow** on the right side of the header
- **"▶ Click to configure"** badge in blue
- Only status badges visible (session context, execution status, etc.)

### Expanded Node
When a node is expanded, you'll see:
- **▼ Arrow** on the right side of the header
- Full configuration panel below the header
- All available settings for that node type

## Node Configuration Options

### All Nodes (Common Settings)

#### **Session Context**
Controls when the node executes in the flow lifecycle:
- **Pre-Session** - Runs before session starts
- **Session Init** - Creates first message
- **In-Session** - Runs in conversation (default)
- **Out-of-Session** - Runs in parallel
- **Post-Session** - Runs after completion

See [Session-Aware Flows](./session-aware-flows.md) for details.

#### **Join Strategy**
When a node has multiple inputs, controls how they're combined:
- **Last** - Use only the last input (default)
- **First** - Use only the first input
- **Concat** - Concatenate all inputs with newlines

#### **Breakpoint (BP)**
Click the "BP" button in the header to set a breakpoint:
- **White BP** - Breakpoint enabled (flow will pause here)
- **Gray BP** - Breakpoint disabled

### Node-Specific Settings

#### **User Message** (👤)
- **No additional settings** - Just passes through input
- Typically used as session-init to create the first user message

#### **LLM Message** (💬)
- **Retry Attempts** - Number of times to retry on failure
- **Retry Backoff (ms)** - Delay between retries

#### **Redactor** (🧹)
- **☑️ Enabled** - Turn redaction on/off
- **☑️ Redact Emails** - Mask email addresses
- **☑️ Redact API Keys** - Mask API keys
- **☑️ Redact AWS Keys** - Mask AWS access keys
- **☑️ Redact 16+ Digit Numbers** - Mask long numbers (credit cards, etc.)

#### **Budget Guard** (💰)
- **Budget (USD)** - Maximum cost allowed
- **☑️ Block on Exceed** - Stop flow if budget exceeded

#### **Error Detection** (⚠️)
- **☑️ Enabled** - Turn error detection on/off
- **Error Patterns** - List of patterns to detect (comma-separated)
- **☑️ Block when flagged** - Stop flow if error detected

#### **Approval Gate** (✅)
- **☑️ Require approval** - Pause flow for manual approval
  - **Checked**: Flow pauses, you must click "Resume"
  - **Unchecked**: Flow continues automatically

See [Approval Gate Node](./approval-gate-node.md) for details.

#### **Stream Response** (🔊)
- **No additional settings** - Streams output to user

## Tips & Tricks

### Tip 1: Hover for Tooltips
Hover over the node header to see:
- "Click to expand and configure this node" (when collapsed)
- "Click to collapse configuration" (when expanded)

### Tip 2: Edit Node Labels
Click the node label (in the header) to rename it:
- Makes flows easier to understand
- Helps identify nodes in execution logs
- Example: "Chat" → "Generate Email Draft"

### Tip 3: Use Breakpoints for Debugging
Set breakpoints on nodes to pause execution:
1. Click "BP" button in node header
2. Run the flow
3. Flow pauses before executing that node
4. Review state in debug panel
5. Click "Resume" to continue

### Tip 4: Session Context Badges
Nodes show colored badges for non-default session contexts:
- **⚙️ PRE** (Purple) - Pre-session
- **🎬 INIT** (Violet) - Session init
- **🔍 OBS** (Cyan) - Out-of-session
- **🏁 POST** (Lime) - Post-session

### Tip 5: Collapse Nodes to Save Space
After configuring, collapse nodes to see more of your flow:
- Click the header to collapse
- The "▶ Click to configure" badge reminds you it's configurable
- All settings are preserved when collapsed

## Common Workflows

### Workflow 1: Configure a New Node
```
1. Drag node from palette to canvas
2. Click node header to expand
3. Set session context (if needed)
4. Configure node-specific settings
5. Click header to collapse
6. Connect to other nodes
```

### Workflow 2: Review Existing Configuration
```
1. Click node header to expand
2. Review current settings
3. Make changes if needed
4. Click header to collapse
```

### Workflow 3: Debug with Breakpoints
```
1. Click "BP" on nodes you want to inspect
2. Run the flow
3. Flow pauses at each breakpoint
4. Review execution log and state
5. Click "Resume" to continue
6. Click "BP" again to disable breakpoint
```

### Workflow 4: Configure Session-Aware Flow
```
1. Expand each node
2. Set session context appropriately:
   - Setup nodes → Pre-Session
   - Initial message → Session Init
   - Main logic → In-Session
   - Parallel operations → Out-of-Session
   - Cleanup → Post-Session
3. Collapse nodes
4. Verify flow with session badges
```

## Troubleshooting

### Problem: Can't see configuration options
**Solution**: Click the node header to expand it. Look for the ▶ arrow.

### Problem: Changes aren't saved
**Solution**: Changes are saved automatically. If you don't see them, try:
1. Expand the node again to verify
2. Check if you clicked outside the input field
3. Refresh the page and check if changes persist

### Problem: Don't know what a setting does
**Solution**: 
1. Check the node-specific documentation (links above)
2. Hover over settings for tooltips (where available)
3. Try the setting and observe the execution log

### Problem: Node is too wide/narrow
**Solution**: Nodes auto-size based on content. To adjust:
1. Edit the node label to be shorter/longer
2. Collapse the node to minimize width
3. Nodes have min-width: 200px, max-width: 350px

## Keyboard Shortcuts

Currently, node configuration is mouse-driven. Future enhancements may include:
- **Enter** - Expand/collapse selected node
- **Tab** - Navigate between configuration fields
- **Esc** - Collapse expanded node

## Best Practices

### ✅ DO:
- **Expand nodes to configure** - Don't guess, check the settings
- **Use descriptive labels** - "Generate Email" not "Chat 1"
- **Set session context** - Use the right context for each node
- **Collapse after configuring** - Keep your canvas clean
- **Use breakpoints** - Debug complex flows step-by-step

### ❌ DON'T:
- **Leave default labels** - "Chat", "Chat 2", "Chat 3" is confusing
- **Ignore session context** - It affects execution order
- **Keep all nodes expanded** - Makes the canvas cluttered
- **Forget to test** - Run the flow to verify configuration

## Summary

Configuring nodes is simple:
1. **Click the header** to expand
2. **Make your changes** in the configuration panel
3. **Click the header** to collapse

Look for the **"▶ Click to configure"** badge on collapsed nodes as a reminder that they're configurable!

For detailed information on specific nodes, see:
- [Session-Aware Flows](./session-aware-flows.md)
- [Approval Gate Node](./approval-gate-node.md)

