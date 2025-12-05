import { Text } from '@mantine/core'

interface GuardConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

export function ApprovalGateConfig({ config, onConfigChange }: GuardConfigProps) {
  return (
    <div style={containerStyle}>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={!!config.requireApproval}
          onChange={(e) => onConfigChange({ requireApproval: e.target.checked })}
        />
        <span>Require approval</span>
      </label>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        {config.requireApproval
          ? '⏸ Flow will pause here and wait for manual approval (click Resume to continue)'
          : '✓ Flow will continue automatically without pausing'}
      </Text>
    </div>
  )
}

export function BudgetGuardConfig({ config, onConfigChange }: GuardConfigProps) {
  return (
    <div style={containerStyle}>
      <label style={{ ...checkboxRowStyle, color: '#cccccc' }}>
        <span style={{ fontSize: 10, color: '#888', width: 60 }}>Budget:</span>
        <input
          type="number"
          step="0.01"
          value={config.budgetUSD || ''}
          onChange={(e) => onConfigChange({ budgetUSD: e.target.value })}
          placeholder="USD"
          style={numberInputStyle}
        />
      </label>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={!!config.blockOnExceed}
          onChange={(e) => onConfigChange({ blockOnExceed: e.target.checked })}
        />
        <span>Block on exceed</span>
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

const checkboxRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#cccccc',
  fontSize: 10,
} as const

const descriptionStyle = {
  fontSize: 9,
  lineHeight: 1.3
} as const

const numberInputStyle = {
  flex: 1,
  padding: '2px 4px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}
