import { Handle, Position } from 'reactflow'
import { useAppStore } from '../../store'
import { CONNECTION_COLORS } from '../../../shared/connection-colors'

interface NodeHandlesProps {
  nodeType: string
  config?: any
  onHeightCalculated?: (height: number) => void
  nodeId?: string
}

export default function NodeHandles({ nodeType, config }: NodeHandlesProps) {
  // Entry nodes don't need input - they define the root context
  const isEntryNode = nodeType === 'defaultContextStart' || nodeType === 'newContext'

  // Determine context color based on node type
  const contextColor = nodeType === 'newContext' ? CONNECTION_COLORS.contextIsolated : CONNECTION_COLORS.context

  // intentRouter has dynamic outputs based on configured routes
  const isIntentRouter = nodeType === 'intentRouter'
  const intentRoutes = isIntentRouter ? Object.keys(config?.routes || {}) : []

  // Get flow graph for portal output dynamic handles
  const feNodes = useAppStore((s) => s.feNodes)
  const feEdges = useAppStore((s) => s.feEdges)

  // Define inputs and outputs based on node type
  const inputs: Array<{ id: string; label: string; color?: string }> = []
  const outputs: Array<{ id: string; label: string; color?: string }> = []

  // Input handles - V2 architecture with explicit Context In / Data In
  if (nodeType === 'portalInput') {
    // Portal Input has Context In and Data In (both optional)
    inputs.push({ id: 'context', label: 'Context In', color: contextColor })
    inputs.push({ id: 'data', label: 'Data In', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'portalOutput') {
    // Portal Output has no inputs - it pulls from the portal registry
    // No input handles
  } else if (nodeType === 'parallelJoin') {
    // Join node has multiple data inputs
    inputs.push({ id: 'data-1', label: 'Data In 1', color: CONNECTION_COLORS.data })
    inputs.push({ id: 'data-2', label: 'Data In 2', color: CONNECTION_COLORS.data })
    inputs.push({ id: 'data-3', label: 'Data In 3', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'llmRequest') {
    // LLM Request node has Context In, Data In, and Tools inputs
    if (!isEntryNode) {
      inputs.push({ id: 'context', label: 'Context In', color: contextColor })
      inputs.push({ id: 'data', label: 'Data In', color: CONNECTION_COLORS.data })
      inputs.push({ id: 'tools', label: 'Tools', color: CONNECTION_COLORS.tools })
    }
  } else if (nodeType === 'userInput') {
    // UserInput node has Context In only (Data In comes from UI pause/resume)
    if (!isEntryNode) {
      inputs.push({ id: 'context', label: 'Context In', color: contextColor })
    }
  } else if (nodeType === 'tools') {
    // Tools node has optional Context In and Data In
    inputs.push({ id: 'context', label: 'Context In', color: contextColor })
    inputs.push({ id: 'data', label: 'Data In', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'injectMessages') {
    // InjectMessages node has Context In and optional dynamic message inputs
    inputs.push({ id: 'context', label: 'Context In', color: contextColor })
    inputs.push({ id: 'userMessage', label: 'User Message', color: CONNECTION_COLORS.data })
    inputs.push({ id: 'assistantMessage', label: 'Assistant Message', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'defaultContextStart' || nodeType === 'newContext') {
    // Entry nodes: add System Instructions In input (no Context/Data inputs)
    inputs.push({ id: 'systemInstructionsIn', label: 'System Instructions In', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'readFile') {
    // readFile has no inputs
  } else if (!isEntryNode) {
    // All other nodes have Context In and Data In
    inputs.push({ id: 'context', label: 'Context In', color: contextColor })
    inputs.push({ id: 'data', label: 'Data In', color: CONNECTION_COLORS.data })
  }

  // Output handles - V2 architecture with explicit Context Out / Data Out
  if (nodeType === 'portalInput') {
    // Portal Input has no outputs - it stores data in the portal registry
    // No output handles
  } else if (nodeType === 'portalOutput') {
    // Portal Output dynamically shows outputs based on what's connected to matching Portal Input
    const portalId = config?.id
    if (portalId) {
      // Find the matching Portal Input node
      const matchingInputNode = feNodes.find(
        (n: any) => (n.data as any)?.nodeType === 'portalInput' && (n.data as any)?.config?.id === portalId
      )

      if (matchingInputNode) {
        // Check which handles are connected to the Portal Input
        const inputNodeId = matchingInputNode.id
        const connectedHandles = new Set(
          feEdges
            .filter((e: any) => e.target === inputNodeId)
            .map((e: any) => e.targetHandle || 'context')
        )

        // Only show outputs for connected inputs
        if (connectedHandles.has('context')) {
          outputs.push({ id: 'context', label: 'Context Out', color: contextColor })
        }
        if (connectedHandles.has('data')) {
          outputs.push({ id: 'data', label: 'Data Out', color: CONNECTION_COLORS.data })
        }
      }
    }
  } else if (isIntentRouter && intentRoutes.length > 0) {
    // Each intent gets both Context Out and Data Out
    intentRoutes.forEach(intent => {
      outputs.push({ id: `${intent}-context`, label: `${intent} Context`, color: contextColor })
      outputs.push({ id: `${intent}-data`, label: `${intent} Data`, color: CONNECTION_COLORS.data })
    })
  } else if (nodeType === 'conditional' || nodeType === 'parallelSplit') {
    outputs.push({ id: 'out-1', label: 'Data Out 1', color: CONNECTION_COLORS.data })
    outputs.push({ id: 'out-2', label: 'Data Out 2', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'llmRequest' || nodeType === 'userInput') {
    // LLM Request and userInput nodes have Context Out and Data Out
    // - Context Out: passes conversation context (for continuing conversation)
    // - Data Out: passes only the message text (for using output elsewhere)
    outputs.push({ id: 'context', label: 'Context Out', color: contextColor })
    outputs.push({ id: 'data', label: 'Data Out', color: CONNECTION_COLORS.data })
  } else if (nodeType === 'tools') {
    // Tools node has Context Out and Tools output
    outputs.push({ id: 'context', label: 'Context Out', color: contextColor })
    outputs.push({ id: 'tools', label: 'Tools', color: CONNECTION_COLORS.tools })
  } else if (nodeType === 'defaultContextStart' || nodeType === 'newContext') {
    // Entry nodes only have Context Out (no data)
    outputs.push({ id: 'context', label: 'Context Out', color: contextColor })
  } else if (nodeType === 'readFile') {
    // readFile outputs only Data Out
    outputs.push({ id: 'data', label: 'Data Out', color: CONNECTION_COLORS.data })
  } else {
    // All other nodes have Context Out and Data Out
    outputs.push({ id: 'context', label: 'Context Out', color: contextColor })
    outputs.push({ id: 'data', label: 'Data Out', color: CONNECTION_COLORS.data })
  }

  // Calculate minimum height needed for handles
  // Each handle needs ~20px of vertical space (more compact)
  const maxHandles = Math.max(inputs.length, outputs.length)
  // Slightly larger row height and offset to avoid overlap with header/overlays
  const minHeight = Math.max(30, maxHandles * 24) // At least 30px, or 24px per handle

  // Debug: log handles for LLM Request nodes
  if (nodeType === 'llmRequest') {
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
            top: `${idx * 24 + 18}px`, // Stack from top with 24px spacing, extra top offset for safety
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
              zIndex: 50,
              pointerEvents: 'all',
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
            top: `${idx * 24 + 18}px`, // Stack from top with 24px spacing, extra top offset for safety
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
              zIndex: 50,
              pointerEvents: 'all',
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

