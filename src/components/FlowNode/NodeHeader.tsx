interface NodeHeaderProps {
  kind: string
  color: string
  label: string
  expanded: boolean
  onLabelChange: (label: string) => void
  onToggleExpanded: () => void
}

const NODE_KIND_LABELS: Record<string, string> = {
  defaultContextStart: 'Context Start',
  userInput: 'User Input',
  manualInput: 'Manual Input',
  newContext: 'New Context',
  chat: 'LLM Message',
  tools: 'Tools',
  intentRouter: 'Intent Router',
  parallelSplit: 'Split',
  parallelJoin: 'Merge',
  redactor: 'Redactor',
  budgetGuard: 'Budget Guard',
  errorDetection: 'Error Detection',
  approvalGate: 'Approval Gate',
}

export default function NodeHeader({
  kind,
  color,
  label,
  expanded,
  onLabelChange,
  onToggleExpanded,
}: NodeHeaderProps) {
  return (
    <div
      style={{
        background: color,
        color: 'white',
        padding: '8px 10px',
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      {/* Node type label - draggable area */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          cursor: 'grab',
          padding: '4px 0',
        }}
        title="Drag to move node"
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            opacity: 0.9,
            background: 'rgba(0,0,0,0.25)',
            padding: '3px 8px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}
        >
          {NODE_KIND_LABELS[kind] || kind}
        </span>
        <input
          className="nodrag"
          value={label}
          onChange={(e) => {
            e.stopPropagation()
            onLabelChange(e.target.value)
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
            color: 'white',
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: 4,
            flex: 1,
            outline: 'none',
            cursor: 'text',
          }}
          placeholder="Node label"
        />
      </div>

      {/* Controls area - also nodrag for interaction */}
      <div className="nodrag" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          onClick={onToggleExpanded}
          style={{
            fontSize: 16,
            opacity: 0.9,
            fontWeight: 'bold',
            padding: '0 4px',
            transition: 'transform 0.2s ease',
            cursor: 'pointer',
          }}
          title={expanded ? 'Click to collapse' : 'Click to expand'}
        >
          {expanded ? '▼' : '▶'}
        </span>
      </div>
    </div>
  )
}

