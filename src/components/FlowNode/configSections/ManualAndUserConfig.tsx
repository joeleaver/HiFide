import { Text } from '@mantine/core'
import { useDraftField } from '../../../hooks/useDraftField'

interface ManualInputConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

export function UserInputInfo() {
  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        👤 Pauses flow execution and waits for user input. Use this to create interactive loops or get feedback mid-flow.
      </Text>
      <Text size="xs" c="dimmed" style={{ ...descriptionStyle, fontStyle: 'italic' }}>
        No configuration needed - just connect it in your flow where you want to wait for user input.
      </Text>
    </div>
  )
}

export function ManualInputConfig({ config, onConfigChange }: ManualInputConfigProps) {
  const external = config.message || ''
  const message = useDraftField(external, (v) => onConfigChange({ message: v }), { debounceMs: 250 })

  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        ✍️ Sends a pre-configured user message to the LLM in the current context. Useful for multi-turn conversations.
      </Text>
      <label style={fieldStyle}>
        <span style={labelStyle}>Message:</span>
        <textarea
          value={message.draft}
          onChange={(e) => message.onChange(e.target.value)}
          onFocus={message.onFocus}
          onBlur={message.onBlur}
          placeholder="Enter the user message to send (e.g., 'Now explain that in simpler terms...')"
          rows={3}
          style={textareaStyle}
        />
      </label>
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

const textareaStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'inherit',
  resize: 'vertical' as const,
} as const
