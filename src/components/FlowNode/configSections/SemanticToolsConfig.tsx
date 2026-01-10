import { Text } from '@mantine/core'

interface SemanticToolsConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

const DEFAULT_SEARCH_LIMIT = 5
const DEFAULT_SIMILARITY_THRESHOLD = 0.3

export function SemanticToolsConfig({ config, onConfigChange }: SemanticToolsConfigProps) {
  const searchLimit = config.searchLimit ?? DEFAULT_SEARCH_LIMIT
  const threshold = config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD

  return (
    <div style={wrapperStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        Provides semantic tool discovery. Connect a <strong>Tools</strong> node to the tools input
        to select which tools are available. The LLM uses <code>searchTools</code> to find relevant tools,
        then <code>executeTool</code> to run them.
      </Text>

      <div style={connectionHintStyle}>
        <Text size="xs" style={{ fontSize: 9, fontWeight: 600, color: '#f97316' }}>
          Required Connection
        </Text>
        <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
          Tools node (tools output) → This node (tools input)
        </Text>
      </div>

      <div style={sectionStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Search Result Limit</span>
          <input
            type="number"
            min="1"
            max="20"
            value={searchLimit}
            onChange={(e) => onConfigChange({ searchLimit: parseInt(e.target.value) || DEFAULT_SEARCH_LIMIT })}
            style={inputStyle}
          />
          <Text size="xs" c="dimmed" style={hintStyle}>
            Maximum tools returned per search query (1-20)
          </Text>
        </label>
      </div>

      <div style={sectionStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Similarity Threshold: {Math.round(threshold * 100)}%</span>
          <input
            type="range"
            min="10"
            max="90"
            step="5"
            value={threshold * 100}
            onChange={(e) => onConfigChange({ similarityThreshold: parseInt(e.target.value) / 100 })}
            style={sliderStyle}
          />
          <div style={sliderLabelsStyle}>
            <span>10%</span>
            <span>50%</span>
            <span>90%</span>
          </div>
          <Text size="xs" c="dimmed" style={hintStyle}>
            Minimum relevance score to include in results (lower = more results)
          </Text>
        </label>
      </div>

      <div style={infoBoxStyle}>
        <Text size="xs" style={{ fontSize: 9, fontWeight: 600, color: '#4ade80', marginBottom: 4 }}>
          Token Savings Estimate
        </Text>
        <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
          Traditional: ~6,000 tokens (40+ tool schemas)
        </Text>
        <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
          Semantic: ~200 tokens + ~350 per search
        </Text>
        <Text size="xs" style={{ fontSize: 9, color: '#4ade80', fontWeight: 600, marginTop: 4 }}>
          ~85% reduction for typical tasks
        </Text>
      </div>

      <div style={workflowStyle}>
        <Text size="xs" style={{ fontSize: 9, fontWeight: 600, color: '#888', marginBottom: 4 }}>
          Typical Flow Setup
        </Text>
        <Text size="xs" c="dimmed" style={{ fontSize: 9, fontFamily: 'monospace' }}>
          Context Start → Tools → Semantic Tools → LLM Request
        </Text>
      </div>
    </div>
  )
}

const wrapperStyle = {
  padding: 10,
  background: '#1e1e1e',
  borderTop: '1px solid #333',
  fontSize: 11,
}

const descriptionStyle = {
  fontSize: 9,
  lineHeight: 1.4,
  marginBottom: 12,
} as const

const connectionHintStyle = {
  padding: 8,
  background: '#2d2a1a',
  borderRadius: 4,
  border: '1px solid #4a3f1a',
  marginBottom: 12,
}

const sectionStyle = {
  marginBottom: 12,
}

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
}

const labelStyle = {
  fontSize: 10,
  fontWeight: 600,
  color: '#e0e0e0',
} as const

const hintStyle = {
  fontSize: 9,
  lineHeight: 1.3,
  marginTop: 2,
} as const

const inputStyle = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
  width: 80,
}

const sliderStyle = {
  width: '100%',
  height: 4,
  cursor: 'pointer',
  accentColor: '#4ade80',
}

const sliderLabelsStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 8,
  color: '#888',
  marginTop: 2,
}

const infoBoxStyle = {
  padding: 8,
  background: '#1a2e1a',
  borderRadius: 4,
  border: '1px solid #2d4a2d',
  marginBottom: 12,
}

const workflowStyle = {
  padding: 8,
  background: '#1a1a2e',
  borderRadius: 4,
  border: '1px solid #2d2d4a',
}
