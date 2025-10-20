import type { NodeProps } from 'reactflow'
import NodeHandles from './NodeHandles'
import NodeHeader from './NodeHeader'
import NodeStatusBadges from './NodeStatusBadges'
import NodeConfig from './NodeConfig'
import { getNodeColor } from '../../../electron/store/utils/node-colors'

function getNodeTypeFromIdOrData(id: string, data: any): string {
  if (data?.nodeType) return data.nodeType
  const base = id.split('-')[0]
  return base
}

export default function FlowNode(props: NodeProps<any>) {
  const { id, data, selected } = props
  const style = (props as any).style
  const nodeType = getNodeTypeFromIdOrData(id, data)
  const color = getNodeColor(nodeType)
  const label = data?.labelBase || data?.label || id
  const status = data?.status as string | undefined
  const durationMs = data?.durationMs as number | undefined
  const costUSD = data?.costUSD as number | undefined
  const config = data?.config || {}

  // Get handlers from data (passed from FlowCanvasPanel)
  const onLabelChange = data?.onLabelChange
  const onConfigChange = data?.onConfigChange
  const onExpandToggle = data?.onExpandToggle

  // Expandable state from node data
  const expanded = data?.expanded || false
  const toggleExpanded = () => {
    if (onExpandToggle) {
      onExpandToggle(id)
    }
  }

  const handleLabelChange = (newLabel: string) => {
    if (onLabelChange) {
      onLabelChange(id, newLabel)
    }
  }

  const handleConfigChange = (patch: any) => {
    if (onConfigChange) {
      onConfigChange(id, patch)
    }
  }

  // Determine border and shadow based on status and selection
  const getBorderStyle = () => {
    // If node has custom style from store (execution state), use it
    if (style?.border) return style.border
    // Otherwise use selection or default
    return selected ? '2px solid #569cd6' : '2px solid #333'
  }

  const getBoxShadow = () => {
    // If node has custom shadow from store (execution state), use it
    if (style?.boxShadow !== undefined) return style.boxShadow
    // Otherwise use selection or default
    return selected ? '0 4px 12px rgba(86, 156, 214, 0.3)' : '0 2px 4px rgba(0,0,0,0.4)'
  }

  return (
    <div
      style={{
        background: '#1a1a1a',
        border: getBorderStyle(),
        borderRadius: 8,
        minWidth: 220,
        maxWidth: 350,
        boxShadow: getBoxShadow(),
        transition: 'all 0.2s ease',
        position: 'relative',
        boxSizing: 'border-box',
        overflow: 'visible', // Allow handles to extend outside
      }}
    >
      {/* Header - full width, no handles here */}
      <NodeHeader
        nodeType={nodeType}
        color={color}
        label={label}
        expanded={expanded}
        onLabelChange={handleLabelChange}
        onToggleExpanded={toggleExpanded}
      />

      {/* Handles section - dedicated area below header */}
      <div
        style={{
          position: 'relative',
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 4,
          paddingBottom: 4,
          boxSizing: 'border-box',
          overflow: 'visible', // Allow handles to extend outside
        }}
      >
        <NodeHandles nodeType={nodeType} config={config} nodeId={id} />
      </div>

      {/* Content area - separate from handles */}
      <div
        style={{
          paddingLeft: 10,
          paddingRight: 10,
          paddingBottom: 6,
          boxSizing: 'border-box',
        }}
      >
        {/* Status Badges */}
        <NodeStatusBadges
          sessionContext={config.sessionContext}
          status={status}
          cacheHit={data?.cacheHit}
          durationMs={durationMs}
          costUSD={costUSD}
        />

        {/* Expandable Config Section */}
        {expanded && (
          <NodeConfig
            nodeId={id}
            nodeType={nodeType}
            config={config}
            onConfigChange={handleConfigChange}
          />
        )}
      </div>
    </div>
  )
}

