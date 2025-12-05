import { useMemo } from 'react'
import { Checkbox, Text } from '@mantine/core'
import type { ProviderOption } from '../../../store/sessionUi'
import { SamplingControls } from '../SamplingControls'

interface LLMRequestConfigProps {
  nodeId: string
  config: any
  edges: any[]
  providerOptions: ProviderOption[]
  modelsByProvider: Record<string, any[]>
  sessionProvider?: string
  sessionModel?: string
  onConfigChange: (patch: any) => void
}

export function LLMRequestConfig({
  nodeId,
  config,
  edges,
  providerOptions,
  modelsByProvider,
  sessionProvider,
  sessionModel,
  onConfigChange,
}: LLMRequestConfigProps) {
  const isContextConnected = useMemo(() => (
    edges.some((e: any) => e.target === nodeId && e.targetHandle === 'context')
  ), [edges, nodeId])

  const baseProvider = config.provider || 'openai'
  const baseModels = modelsByProvider[baseProvider as keyof typeof modelsByProvider] || []
  const overrideProvider = config.overrideProvider || baseProvider
  const overrideModels = modelsByProvider[overrideProvider as keyof typeof modelsByProvider] || []

  const ensureOverrideDefaults = () => {
    const provider = overrideProvider || sessionProvider || baseProvider
    const providerModels = modelsByProvider[provider as keyof typeof modelsByProvider] || []
    let model = config.overrideModel as string | undefined
    if (!model) {
      const sessionModelValid = sessionModel && providerModels.some((m: any) => m.value === sessionModel)
      model = sessionModelValid ? sessionModel as string : providerModels[0]?.value
    }
    onConfigChange({ overrideEnabled: true, overrideProvider: provider, overrideModel: model })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!isContextConnected && (
        <div style={sectionStyle}>
          <Text size="xs" c="dimmed" style={descriptionStyle}>
            💬 No context connected. Configure provider/model for this LLM request:
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Provider:</span>
              <select
                value={baseProvider}
                onChange={(e) => onConfigChange({ provider: e.target.value, model: '' })}
                className="nodrag"
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
                value={config.model || (baseModels[0]?.value || '')}
                onChange={(e) => onConfigChange({ provider: baseProvider, model: e.target.value })}
                className="nodrag"
                style={selectStyle}
              >
                {baseModels.map((m: any) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>
          <SamplingControls config={config} onConfigChange={onConfigChange} modelsByProvider={modelsByProvider} />
        </div>
      )}

      {isContextConnected && (
        <div style={sectionStyle}>
          <Checkbox
            label="Override provider/model"
            checked={config.overrideEnabled || false}
            onChange={(e) => {
              if (e.currentTarget.checked) {
                ensureOverrideDefaults()
              } else {
                onConfigChange({ overrideEnabled: false })
              }
            }}
            size="xs"
            styles={{ label: { fontSize: 10, color: '#cccccc', fontWeight: 600 } }}
          />

          {config.overrideEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={fieldStyle}>
                <span style={labelStyle}>Provider:</span>
                <select
                  value={overrideProvider}
                  onChange={(e) => {
                    const next = e.target.value
                    const firstModel = (modelsByProvider[next] || [])[0]?.value || ''
                    onConfigChange({ overrideProvider: next, overrideModel: firstModel })
                  }}
                  className="nodrag"
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
                  value={config.overrideModel || (overrideModels[0]?.value || '')}
                  onChange={(e) => onConfigChange({ overrideModel: e.target.value })}
                  className="nodrag"
                  style={selectStyle}
                >
                  {overrideModels.map((m: any) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                <SamplingControls config={config} onConfigChange={onConfigChange} modelsByProvider={modelsByProvider} prefix="override" />
              </div>
            </div>
          )}
        </div>
      )}

      <label style={inlineFieldStyle}>
        <span style={inlineLabel}>Retry attempts:</span>
        <input
          type="number"
          min="1"
          value={config.retryAttempts || 1}
          onChange={(e) => onConfigChange({ retryAttempts: parseInt(e.target.value) || 1 })}
          style={numberInputStyle}
        />
      </label>
      <label style={inlineFieldStyle}>
        <span style={inlineLabel}>Retry backoff:</span>
        <input
          type="number"
          min="0"
          value={config.retryBackoffMs || 0}
          onChange={(e) => onConfigChange({ retryBackoffMs: parseInt(e.target.value) || 0 })}
          placeholder="ms"
          style={numberInputStyle}
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

const selectStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}

const inlineFieldStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#cccccc'
}

const inlineLabel = {
  fontSize: 10,
  color: '#888',
  width: 80
}

const numberInputStyle = {
  flex: 1,
  padding: '2px 4px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}
