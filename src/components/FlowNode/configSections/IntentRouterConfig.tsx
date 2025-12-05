import { Text } from '@mantine/core'
import type { ProviderOption } from '../../../store/sessionUi'

interface IntentRouterConfigProps {
  config: any
  onConfigChange: (patch: any) => void
  providerOptions: ProviderOption[]
  modelOptions: Record<string, any[]>
}

export function IntentRouterConfig({ config, onConfigChange, providerOptions, modelOptions }: IntentRouterConfigProps) {
  const currentProvider = config.provider || 'openai'
  const providerHasModel = providerOptions.some((p) => p.value === currentProvider)
  const providerList = providerHasModel
    ? providerOptions
    : currentProvider
      ? [...providerOptions, { value: currentProvider, label: `${currentProvider} (no key)` }]
      : providerOptions

  const models = modelOptions[currentProvider as keyof typeof modelOptions] || []

  const routesEntries = Object.entries(config.routes || {})

  const addIntent = () => {
    const newRoutes = { ...config.routes }
    let counter = 1
    while (newRoutes[`intent${counter}`]) counter++
    newRoutes[`intent${counter}`] = ''
    onConfigChange({ routes: newRoutes })
  }

  const updateIntentKey = (idx: number, newKey: string) => {
    const entries = routesEntries.slice()
    const newRoutes: Record<string, string> = {}
    entries.forEach(([key, value], entryIdx) => {
      if (entryIdx === idx) {
        newRoutes[newKey] = value as string
      } else {
        newRoutes[key] = value as string
      }
    })
    onConfigChange({ routes: newRoutes })
  }

  const updateIntentDescription = (intent: string, text: string) => {
    const newRoutes = { ...config.routes, [intent]: text }
    onConfigChange({ routes: newRoutes })
  }

  const removeIntent = (intent: string) => {
    const newRoutes = { ...config.routes }
    delete newRoutes[intent]
    onConfigChange({ routes: newRoutes })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        🔀 Routes flow based on LLM-classified user intent. Passes context through unchanged.
      </Text>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid #3e3e42' }}>
        <Text size="xs" c="dimmed" style={descriptionStyle}>
          Configure the LLM used for intent classification:
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Provider:</span>
            <select
              value={currentProvider}
              onChange={(e) => onConfigChange({ provider: e.target.value, model: '' })}
              className="nodrag"
              style={selectStyle}
            >
              {providerList.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Model:</span>
            <select
              value={config.model || ''}
              onChange={(e) => onConfigChange({ model: e.target.value })}
              className="nodrag"
              style={selectStyle}
            >
              <option value="">Select model...</option>
              {models.map((m: any) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={tableHeader}>
          <span>Intent</span>
          <span>Description</span>
          <span></span>
        </div>

        {routesEntries.map(([intent, description], idx) => (
          <div key={`intent-${idx}`} style={tableRow}>
            <input
              type="text"
              value={intent}
              onChange={(e) => updateIntentKey(idx, e.target.value)}
              placeholder="intent"
              className="nodrag"
              style={intentInputStyle}
            />
            <input
              type="text"
              value={description as string}
              onChange={(e) => updateIntentDescription(intent, e.target.value)}
              placeholder="Description of when to use this intent"
              className="nodrag"
              style={descriptionInputStyle}
            />
            <button
              onClick={() => removeIntent(intent)}
              className="nodrag"
              style={removeButtonStyle}
              title="Remove intent"
            >
              ×
            </button>
          </div>
        ))}

        <button onClick={addIntent} style={addButtonStyle}>
          + Add Intent
        </button>
      </div>

      <Text size="xs" c="blue.4" style={descriptionStyle}>
        💡 The LLM classifies the input text (without conversation context) and routes to the matching intent. Context is passed through unchanged. Only the matched intent's outputs will trigger downstream nodes.
      </Text>
    </div>
  )
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

const tableHeader = {
  display: 'grid',
  gridTemplateColumns: '100px 1fr 24px',
  gap: 4,
  fontSize: 9,
  color: '#888',
  fontWeight: 600,
  paddingBottom: 4,
  borderBottom: '1px solid #3e3e42'
}

const tableRow = {
  display: 'grid',
  gridTemplateColumns: '100px 1fr 24px',
  gap: 4,
  alignItems: 'center'
}

const intentInputStyle = {
  padding: '3px 5px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace'
}

const descriptionInputStyle = {
  padding: '3px 5px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}

const removeButtonStyle = {
  padding: '2px 6px',
  background: '#3e3e42',
  color: '#cccccc',
  border: 'none',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer'
}

const addButtonStyle = {
  padding: '4px 8px',
  background: '#3e3e42',
  color: '#cccccc',
  border: '1px solid #555',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer',
  marginTop: 4,
}
