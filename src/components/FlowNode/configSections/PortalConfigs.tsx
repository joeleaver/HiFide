import { useMemo } from 'react'
import { Text } from '@mantine/core'

interface PortalConfigProps {
  nodeId: string
  config: any
  onConfigChange: (patch: any) => void
  nodes: any[]
}

export function PortalInputConfig({ nodeId, config, onConfigChange, nodes }: PortalConfigProps) {
  const validation = useMemo(() => {
    const portalId = config.id
    if (!portalId) {
      return { isValid: false, error: 'Portal ID is required' }
    }

    const duplicates = nodes.filter((n: any) =>
      (n.data as any)?.nodeType === 'portalInput' &&
      (n.data as any)?.config?.id === portalId &&
      n.id !== nodeId
    )

    if (duplicates.length > 0) {
      return {
        isValid: false,
        error: `Duplicate Portal ID! ${duplicates.length + 1} Portal Input node(s) use "${portalId}"`
      }
    }

    return { isValid: true, error: null }
  }, [nodes, config.id, nodeId])

  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        📥 Stores context and data for retrieval by Portal Output nodes. Reduces edge crossings in complex flows.
      </Text>
      <label style={fieldStyle}>
        <span style={labelStyle}>Portal ID:</span>
        <input
          type="text"
          value={config.id || ''}
          onChange={(e) => onConfigChange({ id: e.target.value })}
          placeholder="Enter unique portal ID (e.g., 'loop-back')"
          style={{
            ...inputStyle,
            border: validation.isValid ? inputStyle.border : '1px solid #ef4444'
          }}
        />
      </label>
      {!validation.isValid && (
        <Text size="xs" style={{ fontSize: 9, lineHeight: 1.3, color: '#ef4444', fontWeight: 600 }}>
          ⚠️ {validation.error}
        </Text>
      )}
      <Text size="xs" c="dimmed" style={{ ...descriptionStyle, fontStyle: 'italic' }}>
        Portal Output nodes with matching ID will retrieve data from this node.
      </Text>
    </div>
  )
}

export function PortalOutputConfig({ config, onConfigChange }: Omit<PortalConfigProps, 'nodeId' | 'nodes'>) {
  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        📤 Retrieves context and data from matching Portal Input node. Reduces edge crossings in complex flows.
      </Text>
      <label style={fieldStyle}>
        <span style={labelStyle}>Portal ID:</span>
        <input
          type="text"
          value={config.id || ''}
          onChange={(e) => onConfigChange({ id: e.target.value })}
          placeholder="Enter portal ID to match (e.g., 'loop-back')"
          style={inputStyle}
        />
      </label>
      <Text size="xs" c="dimmed" style={{ ...descriptionStyle, fontStyle: 'italic' }}>
        Must match the ID of a Portal Input node to retrieve its data.
      </Text>
    </div>
  )
}

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
  marginBottom: 10,
  paddingBottom: 10,
  borderBottom: '1px solid #333'
}

const descriptionStyle = {
  fontSize: 9,
  lineHeight: 1.3
} as const

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4
}

const labelStyle = {
  fontSize: 10,
  color: '#888',
  fontWeight: 600
} as const

const inputStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace'
}
