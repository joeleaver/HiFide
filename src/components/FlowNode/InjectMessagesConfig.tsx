import { Text, Select, Checkbox, NumberInput } from '@mantine/core'
import { useFlowEditorLocal } from '../../store/flowEditorLocal'
import { useMemo } from 'react'

interface InjectMessagesConfigProps {
  nodeId: string
  config: any
  onConfigChange: (patch: any) => void
}

export default function InjectMessagesConfig({ nodeId, config, onConfigChange }: InjectMessagesConfigProps) {
  // Get edges to check if handles are connected
  const feEdges = useFlowEditorLocal((s) => s.edges)

  // Check if userMessage or assistantMessage handles are connected
  const isUserMessageConnected = useMemo(() => {
    return feEdges.some((e: any) => e.target === nodeId && e.targetHandle === 'userMessage')
  }, [feEdges, nodeId])
  
  const isAssistantMessageConnected = useMemo(() => {
    return feEdges.some((e: any) => e.target === nodeId && e.targetHandle === 'assistantMessage')
  }, [feEdges, nodeId])
  
  return (
    <div className="nodrag" style={{ padding: 10, background: '#1e1e1e', borderTop: '1px solid #333', fontSize: 11, overflow: 'hidden', wordWrap: 'break-word' }}>
      <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, marginBottom: 10 }}>
        💬 Injects a user/assistant message pair into conversation history. Useful for context bootstrapping.
      </Text>
      
      {/* User Message */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>User Message:</span>
        <textarea
          value={isUserMessageConnected ? '' : (config.staticUserMessage || '')}
          onChange={(e) => onConfigChange({ staticUserMessage: e.target.value })}
          placeholder={isUserMessageConnected ? 'Connected' : 'Enter user message...'}
          disabled={isUserMessageConnected}
          rows={3}
          style={{
            width: '100%',
            padding: 6,
            fontSize: 10,
            background: isUserMessageConnected ? '#2a2a2a' : '#1a1a1a',
            color: isUserMessageConnected ? '#666' : '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            resize: 'vertical',
            fontFamily: 'monospace',
            cursor: isUserMessageConnected ? 'not-allowed' : 'text',
          }}
        />
      </label>
      
      {/* Assistant Message */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Assistant Message:</span>
        <textarea
          value={isAssistantMessageConnected ? '' : (config.staticAssistantMessage || '')}
          onChange={(e) => onConfigChange({ staticAssistantMessage: e.target.value })}
          placeholder={isAssistantMessageConnected ? 'Connected' : 'Enter assistant message...'}
          disabled={isAssistantMessageConnected}
          rows={3}
          style={{
            width: '100%',
            padding: 6,
            fontSize: 10,
            background: isAssistantMessageConnected ? '#2a2a2a' : '#1a1a1a',
            color: isAssistantMessageConnected ? '#666' : '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            resize: 'vertical',
            fontFamily: 'monospace',
            cursor: isAssistantMessageConnected ? 'not-allowed' : 'text',
          }}
        />
      </label>
      
      {/* Injection Mode */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Injection Mode:</span>
        <Select
          value={config.injectionMode || 'prepend'}
          onChange={(value) => onConfigChange({ injectionMode: value })}
          data={[
            { value: 'prepend', label: 'Prepend (add to beginning)' },
            { value: 'append', label: 'Append (add to end)' },
          ]}
          size="xs"
          styles={{
            input: {
              fontSize: 10,
              background: '#1a1a1a',
              color: '#e0e0e0',
              border: '1px solid #444',
            },
            dropdown: {
              background: '#1a1a1a',
              border: '1px solid #444',
            },
            option: {
              fontSize: 10,
              '&[data-selected]': {
                background: '#2a2a2a',
              },
              '&[data-hovered]': {
                background: '#333',
              },
            },
          }}
        />
      </label>
      
      {/* Pin to Top */}
      <div style={{ marginBottom: 10 }}>
        <Checkbox
          label="Pin to Top"
          checked={config.pinned || false}
          onChange={(e) => onConfigChange({ pinned: e.currentTarget.checked })}
          size="xs"
          styles={{
            label: { fontSize: 10, color: '#e0e0e0' },
          }}
        />
        <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, marginTop: 4, marginLeft: 24 }}>
          Pinned messages survive context windowing
        </Text>
      </div>
      
      {/* Priority (only shown if pinned) */}
      {config.pinned && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Priority:</span>
          <NumberInput
            value={config.priority || 50}
            onChange={(value) => onConfigChange({ priority: value })}
            min={1}
            max={100}
            size="xs"
            styles={{
              input: {
                fontSize: 10,
                background: '#1a1a1a',
                color: '#e0e0e0',
                border: '1px solid #444',
              },
            }}
          />
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            Higher priority = kept first during windowing (1-100)
          </Text>
        </label>
      )}
      
      {/* Validation warnings */}
      {!isUserMessageConnected && !config.staticUserMessage?.trim() && (
        <Text size="xs" c="yellow.5" style={{ fontSize: 9, marginTop: 10 }}>
          ⚠️ User message is required
        </Text>
      )}
      {!isAssistantMessageConnected && !config.staticAssistantMessage?.trim() && (
        <Text size="xs" c="yellow.5" style={{ fontSize: 9, marginTop: 4 }}>
          ⚠️ Assistant message is required
        </Text>
      )}
    </div>
  )
}

