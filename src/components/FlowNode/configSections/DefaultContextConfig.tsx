import { Text } from '@mantine/core'
import { SamplingControls } from '../SamplingControls'

interface DefaultContextConfigProps {
  config: any
  onConfigChange: (patch: any) => void
  modelsByProvider: Record<string, any[]>
  isSysInConnected: boolean
}

export function DefaultContextConfig({ config, onConfigChange, modelsByProvider, isSysInConnected }: DefaultContextConfigProps) {
  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        🎬 Flow entry point. Uses the global provider/model settings. Configure system instructions below.
      </Text>
      <label style={fieldStyle}>
        <span style={labelStyle}>System Instructions:</span>
        {!isSysInConnected ? (
          <textarea
            value={config.systemInstructions || ''}
            onChange={(e) => onConfigChange({ systemInstructions: e.target.value })}
            placeholder="Optional system instructions for the AI (e.g., 'You are a helpful assistant...')"
            rows={4}
            style={textareaStyle}
          />
        ) : (
          <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
            Receiving instructions from input edge (System Instructions In)
          </Text>
        )}
      </label>

      <SamplingControls config={config} onConfigChange={onConfigChange} modelsByProvider={modelsByProvider} />
    </div>
  )
}

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 10,
  paddingBottom: 10,
  borderBottom: '1px solid #333'
} as const

const descriptionStyle = {
  fontSize: 9,
  lineHeight: 1.3
} as const

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4
} as const

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
