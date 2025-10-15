import { Handle, Position } from 'reactflow'

interface NodeHandlesProps {
  kind: string
  config?: any
  onHeightCalculated?: (height: number) => void
}

export default function NodeHandles({ kind, config }: NodeHandlesProps) {
  // Entry nodes don't need input - they define the root context
  const isEntryNode = kind === 'defaultContextStart'

  // intentRouter has dynamic outputs based on configured routes
  const isIntentRouter = kind === 'intentRouter'
  const intentRoutes = isIntentRouter ? Object.keys(config?.routes || {}) : []

  // Define inputs and outputs based on node kind
  const inputs: Array<{ id: string; label: string; color?: string }> = []
  const outputs: Array<{ id: string; label: string; color?: string }> = []

  // Input handles - V2 architecture with explicit Context In / Data In
  if (kind === 'parallelJoin') {
    // Join node has multiple data inputs
    inputs.push({ id: 'data-1', label: 'Data In 1', color: '#3498db' })
    inputs.push({ id: 'data-2', label: 'Data In 2', color: '#3498db' })
    inputs.push({ id: 'data-3', label: 'Data In 3', color: '#3498db' })
  } else if (kind === 'chat') {
    // Chat node has Context In, Data In, and Tools inputs
    if (!isEntryNode) {
      inputs.push({ id: 'context', label: 'Context In', color: '#9b59b6' })
      inputs.push({ id: 'data', label: 'Data In', color: '#3498db' })
      inputs.push({ id: 'tools', label: 'Tools', color: '#f97316' })
    }
  } else if (kind === 'userInput') {
    // UserInput node has Context In only (Data In comes from UI pause/resume)
    if (!isEntryNode) {
      inputs.push({ id: 'context', label: 'Context In', color: '#9b59b6' })
    }
  } else if (kind === 'tools') {
    // Tools node has optional Context In and Data In
    inputs.push({ id: 'context', label: 'Context In', color: '#9b59b6' })
    inputs.push({ id: 'data', label: 'Data In', color: '#3498db' })
  } else if (!isEntryNode) {
    // All other nodes have Context In and Data In
    inputs.push({ id: 'context', label: 'Context In', color: '#9b59b6' })
    inputs.push({ id: 'data', label: 'Data In', color: '#3498db' })
  }

  // Output handles - V2 architecture with explicit Context Out / Data Out
  if (isIntentRouter && intentRoutes.length > 0) {
    // Each intent gets both Context Out and Data Out
    intentRoutes.forEach(intent => {
      outputs.push({ id: `${intent}-context`, label: `${intent} Context`, color: '#9b59b6' })
      outputs.push({ id: `${intent}-data`, label: `${intent} Data`, color: '#f39c12' })
    })
  } else if (kind === 'conditional' || kind === 'parallelSplit') {
    outputs.push({ id: 'out-1', label: 'Data Out 1', color: '#2ecc71' })
    outputs.push({ id: 'out-2', label: 'Data Out 2', color: '#2ecc71' })
  } else if (kind === 'chat' || kind === 'userInput') {
    // Chat and userInput nodes have Context Out and Data Out
    // - Context Out: passes conversation context (for continuing conversation)
    // - Data Out: passes only the message text (for using output elsewhere)
    outputs.push({ id: 'context', label: 'Context Out', color: '#9b59b6' })
    outputs.push({ id: 'data', label: 'Data Out', color: '#2ecc71' })
  } else if (kind === 'tools') {
    // Tools node has Context Out and Tools output
    outputs.push({ id: 'context', label: 'Context Out', color: '#9b59b6' })
    outputs.push({ id: 'tools', label: 'Tools', color: '#f97316' })
  } else if (kind === 'defaultContextStart') {
    // Entry node only has Context Out (no data)
    outputs.push({ id: 'context', label: 'Context Out', color: '#9b59b6' })
  } else {
    // All other nodes have Context Out and Data Out
    outputs.push({ id: 'context', label: 'Context Out', color: '#9b59b6' })
    outputs.push({ id: 'data', label: 'Data Out', color: '#2ecc71' })
  }

  // Calculate minimum height needed for handles
  // Each handle needs ~20px of vertical space (more compact)
  const maxHandles = Math.max(inputs.length, outputs.length)
  const minHeight = Math.max(30, maxHandles * 20) // At least 30px, or 20px per handle

  // Debug: log handles for chat nodes
  if (kind === 'chat') {
    console.log(`[NodeHandles] Chat node inputs:`, inputs.map(i => i.id))
    console.log(`[NodeHandles] Chat node outputs:`, outputs.map(o => o.id))
    console.log(`[NodeHandles] Calculated minHeight:`, minHeight)
  }

  return (
    <div style={{ position: 'relative', minHeight: `${minHeight}px` }}>
      {/* Render input handles on the left */}
      {inputs.map((input, idx) => (
        <div
          key={input.id}
          style={{
            position: 'absolute',
            left: 0,
            top: `${idx * 20 + 10}px`, // Stack from top with 20px spacing, 10px offset
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            zIndex: 10, // Above content
          }}
        >
          <Handle
            id={input.id}
            type="target"
            position={Position.Left}
            isConnectable={true}
            style={{
              position: 'absolute',
              left: -6, // Half the handle width outside the node border
              top: '50%',
              transform: 'translateY(-50%)',
              background: input.color || '#3498db',
              width: 12,
              height: 12,
              border: '2px solid #1a1a1a',
              borderRadius: '50%',
              cursor: 'crosshair',
            }}
          />
          <span
            className="nodrag"
            style={{
              fontSize: 10,
              color: '#aaa',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              userSelect: 'none',
              marginLeft: 12, // Space for the handle
            }}
          >
            {input.label}
          </span>
        </div>
      ))}

      {/* Render output handles on the right */}
      {outputs.map((output, idx) => (
        <div
          key={output.id}
          style={{
            position: 'absolute',
            right: 0,
            top: `${idx * 20 + 10}px`, // Stack from top with 20px spacing, 10px offset
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexDirection: 'row-reverse',
            zIndex: 10, // Above content
          }}
        >
          <Handle
            id={output.id}
            type="source"
            position={Position.Right}
            isConnectable={true}
            style={{
              position: 'absolute',
              right: -6, // Half the handle width outside the node border
              top: '50%',
              transform: 'translateY(-50%)',
              background: output.color || '#2ecc71',
              width: 12,
              height: 12,
              border: '2px solid #1a1a1a',
              borderRadius: '50%',
              cursor: 'crosshair',
            }}
          />
          <span
            className="nodrag"
            style={{
              fontSize: 10,
              color: '#aaa',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              userSelect: 'none',
              marginRight: 12, // Space for the handle
            }}
          >
            {output.label}
          </span>
        </div>
      ))}
    </div>
  )
}

