import { useDraftField } from '../../../hooks/useDraftField'

interface ConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

export function RedactorConfig({ config, onConfigChange }: ConfigProps) {
  return (
    <div style={containerStyle}>
      {[
        { key: 'enabled', label: 'Enabled', defaultValue: true },
        { key: 'ruleEmails', label: 'Redact emails' },
        { key: 'ruleApiKeys', label: 'Redact API keys' },
        { key: 'ruleAwsKeys', label: 'Redact AWS keys' },
        { key: 'ruleNumbers16', label: 'Redact 16+ digit numbers' },
      ].map((rule) => (
        <label key={rule.key} style={checkboxRow}>
          <input
            type="checkbox"
            checked={config[rule.key] ?? rule.defaultValue ?? false}
            onChange={(e) => onConfigChange({ [rule.key]: e.target.checked })}
          />
          <span>{rule.label}</span>
        </label>
      ))}
    </div>
  )
}

export function ErrorDetectionConfig({ config, onConfigChange }: ConfigProps) {
  const external = (config.patterns || []).join('\n')
  const patterns = useDraftField(external, (v) => onConfigChange({ patterns: v.split('\n').filter(Boolean) }), { debounceMs: 250 })

  return (
    <div style={containerStyle}>
      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={config.enabled ?? true}
          onChange={(e) => onConfigChange({ enabled: e.target.checked })}
        />
        <span>Enabled</span>
      </label>
      <label style={{ ...fieldStyle, color: '#cccccc' }}>
        <span style={labelStyle}>Error patterns (one per line):</span>
        <textarea
          value={patterns.draft}
          onChange={(e) => patterns.onChange(e.target.value)}
          onFocus={patterns.onFocus}
          onBlur={patterns.onBlur}
          placeholder={"error\nexception\nfailed"}
          rows={3}
          style={textareaStyle}
        />
      </label>
      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={!!config.blockOnFlag}
          onChange={(e) => onConfigChange({ blockOnFlag: e.target.checked })}
        />
        <span>Block when flagged</span>
      </label>
    </div>
  )
}

const containerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  marginBottom: 10,
  paddingBottom: 10,
  borderBottom: '1px solid #333'
}

const checkboxRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#cccccc',
  fontSize: 10,
} as const

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
}

const labelStyle = {
  fontSize: 10,
  color: '#888'
}

const textareaStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace',
  resize: 'vertical' as const,
}
