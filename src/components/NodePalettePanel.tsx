import { Text, Badge } from '@mantine/core'
import { getNodeColor, getNodeCategory, CATEGORY_LABELS, type NodeCategory } from '../../electron/store/utils/node-colors'

const NODE_PALETTE: Array<{ nodeType: string; label: string; icon: string; description: string }> = [
  { nodeType: 'userInput', label: 'User Input', icon: '👤', description: 'Accept user input (entry point or pause mid-flow)' },
  { nodeType: 'manualInput', label: 'Manual Input', icon: '✍️', description: 'Send pre-configured user message mid-flow' },
  { nodeType: 'newContext', label: 'New Context', icon: '🔀', description: 'Create new execution context with different model/provider' },
  { nodeType: 'llmRequest', label: 'LLM Request', icon: '💬', description: 'Send a request to the LLM' },
  { nodeType: 'tools', label: 'Tools', icon: '🔧', description: 'Provide tools to LLM (auto or specific list)' },
  { nodeType: 'injectMessages', label: 'Inject Messages', icon: '💉', description: 'Inject user/assistant message pair into conversation history' },
  { nodeType: 'intentRouter', label: 'Intent Router', icon: '🔀', description: 'Route based on LLM-classified user intent' },
  { nodeType: 'portalInput', label: 'Portal In', icon: '📥', description: 'Store data for portal output (reduces edge crossings)' },
  { nodeType: 'portalOutput', label: 'Portal Out', icon: '📤', description: 'Retrieve data from portal input (reduces edge crossings)' },
  { nodeType: 'parallelSplit', label: 'Split', icon: '⑂', description: 'Split flow into two parallel branches' },
  { nodeType: 'parallelJoin', label: 'Merge', icon: '🔗', description: 'Merge multiple inputs into one output' },
  { nodeType: 'cache', label: 'Cache', icon: '💾', description: 'Cache data to avoid re-executing expensive operations' },
  { nodeType: 'redactor', label: 'Redactor', icon: '🧹', description: 'Redact sensitive data' },
  { nodeType: 'budgetGuard', label: 'Budget Guard', icon: '💰', description: 'Monitor token budget' },
  { nodeType: 'errorDetection', label: 'Error Detection', icon: '⚠️', description: 'Detect error patterns' },
  { nodeType: 'approvalGate', label: 'Approval Gate', icon: '✅', description: 'Require manual approval' },
]

export default function NodePalettePanel() {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  // Group nodes by category
  const nodesByCategory = NODE_PALETTE.reduce((acc, node) => {
    const category = getNodeCategory(node.nodeType) || 'flow-control'
    if (!acc[category]) acc[category] = []
    acc[category].push(node)
    return acc
  }, {} as Record<NodeCategory, typeof NODE_PALETTE>)

  // Define category order
  const categoryOrder: NodeCategory[] = ['input', 'llm', 'flow-control', 'safety']

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1e1e1e',
        borderBottom: '1px solid #3e3e42',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid #3e3e42',
          backgroundColor: '#252526',
        }}
      >
        <Text size="xs" fw={600} c="dimmed">
          NODE PALETTE
        </Text>
      </div>

      {/* Node list grouped by category */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px' }}>
        {categoryOrder.map((category) => {
          const nodes = nodesByCategory[category]
          if (!nodes || nodes.length === 0) return null

          return (
            <div key={category} style={{ marginBottom: 16 }}>
              {/* Category header */}
              <Text
                size="10px"
                fw={700}
                c="dimmed"
                tt="uppercase"
                style={{
                  letterSpacing: '0.5px',
                  marginBottom: 6,
                  paddingLeft: 4,
                }}
              >
                {CATEGORY_LABELS[category]}
              </Text>

              {/* Node badges */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {nodes.map((node) => {
                  const color = getNodeColor(node.nodeType)
                  return (
                    <Badge
                      key={node.nodeType}
                      draggable
                      onDragStart={(e) => onDragStart(e, node.nodeType)}
                      title={node.description}
                      style={{
                        backgroundColor: color,
                        color: '#ffffff',
                        cursor: 'grab',
                        padding: '6px 10px',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.3px',
                        textTransform: 'uppercase',
                        border: 'none',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.05)'
                        e.currentTarget.style.boxShadow = `0 2px 8px ${color}80`
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <span style={{ marginRight: 4 }}>{node.icon}</span>
                      {node.label}
                    </Badge>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

