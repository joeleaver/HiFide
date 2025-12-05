import { Text } from '@mantine/core'
import type { ProviderOption } from '../../../store/sessionUi'
import { SamplingControls } from '../SamplingControls'

interface NewContextConfigProps {
  config: any
  onConfigChange: (patch: any) => void
  providerOptions: ProviderOption[]
  modelsByProvider: Record<string, any[]>
  isSysInConnected: boolean
}

export function NewContextConfig({ config, onConfigChange, providerOptions, modelsByProvider, isSysInConnected }: NewContextConfigProps) {
  const currentProvider = config.provider || 'openai'
  const modelOptions = modelsByProvider[currentProvider as keyof typeof modelsByProvider] || []

  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        🔀 Creates an isolated execution context for parallel flows. Use this for bootstrap flows or background processing that shouldn't pollute the main conversation.
      </Text>

      <label style={fieldStyle}>
        <span style={labelStyle}>Provider:</span>
        <select
          value={currentProvider}
          onChange={(e) => {
            const nextProvider = e.target.value
            const firstModel = (modelsByProvider[nextProvider] || [])[0]?.value || ''
            onConfigChange({ provider: nextProvider, model: firstModel })
          }}
          style={selectStyle}
        >
          {providerOptions.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>Model:</span>
        <select
          value={config.model || (modelOptions[0]?.value || '')}
          onChange={(e) => onConfigChange({ provider: currentProvider, model: e.target.value })}
          style={selectStyle}
        >
          {modelOptions.map((m: any) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>System Instructions:</span>
        {!isSysInConnected ? (
          <textarea
            value={config.systemInstructions || ''}
            onChange={(e) => onConfigChange({ systemInstructions: e.target.value })}
            placeholder="Optional system instructions for this isolated context (e.g., 'You are a code analyzer...')"
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

const selectStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}

const textareaStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'inherit',
  resize: 'vertical' as const,
}
