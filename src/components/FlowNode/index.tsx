import type { NodeProps } from 'reactflow'
import { useAppStore } from '../../store'
import NodeHandles from './NodeHandles'
import NodeHeader from './NodeHeader'
import NodeStatusBadges from './NodeStatusBadges'
import NodeConfig from './NodeConfig'

// Enhanced color map by node kind
const KIND_COLORS: Record<string, string> = {
  defaultContextStart: '#3b82f6',
  userInput: '#4a9eff',
  manualInput: '#06b6d4',
  newContext: '#9b59b6',
  chat: '#a855f7',
  tools: '#f97316',
  intentRouter: '#f39c12',
  redactor: '#14b8a6',
  budgetGuard: '#f59e0b',
  errorDetection: '#f97316',
  approvalGate: '#ef4444',
  parallelSplit: '#8b5cf6',
  parallelJoin: '#10b981',
}

function getKindFromIdOrData(id: string, data: any): string {
  if (data?.kind) return data.kind
  const base = id.split('-')[0]
  return base
}

export default function FlowNode(props: NodeProps<any>) {
  const { id, data, selected, style } = props
  const kind = getKindFromIdOrData(id, data)
  const color = KIND_COLORS[kind] || '#4a4a4a'
  const label = data?.labelBase || data?.label || id
  const status = data?.status as string | undefined
  const durationMs = data?.durationMs as number | undefined
  const costUSD = data?.costUSD as number | undefined
  const config = data?.config || {}

  // Get store actions for inline editing
  const setNodeLabel = useAppStore((s) => s.feSetNodeLabel)
  const patchNodeConfig = useAppStore((s) => s.fePatchNodeConfig)

  // Expandable state from node data
  const expanded = data?.expanded || false
  const toggleExpanded = () => {
    const nodes = useAppStore.getState().feNodes
    const updatedNodes = nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, expanded: !expanded } } : n
    )
    useAppStore.getState().feSetNodes(updatedNodes)
  }

  const handleLabelChange = (newLabel: string) => {
    setNodeLabel(id, newLabel)
  }

  const handleConfigChange = (patch: any) => {
    patchNodeConfig(id, patch)
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
        kind={kind}
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
        <NodeHandles kind={kind} config={config} />
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
            kind={kind}
            config={config}
            onConfigChange={handleConfigChange}
          />
        )}
      </div>
    </div>
  )
}

