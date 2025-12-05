import { Text } from '@mantine/core'
import { useNodeCacheStore } from '../../../store/nodeCacheInspector'

interface CacheConfigProps {
  nodeId: string
  config: any
  onConfigChange: (patch: any) => void
}

export function CacheConfig({ nodeId, config, onConfigChange }: CacheConfigProps) {
  const snapshot = useNodeCacheStore((s) => s.snapshots[nodeId])
  const status = useNodeCacheStore((s) => s.status[nodeId] || 'idle')
  const fetchSnapshot = useNodeCacheStore((s) => s.fetchSnapshot)
  const invalidateCache = useNodeCacheStore((s) => s.invalidateCache)

  if (status === 'idle') {
    void fetchSnapshot(nodeId)
  }

  const cacheAge = snapshot ? ((Date.now() - snapshot.timestamp) / 1000).toFixed(1) : null
  const ttl = config.ttl ?? 300
  const isCacheValid = snapshot && ttl > 0 && cacheAge && parseFloat(cacheAge) < ttl

  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        💾 Caches data from upstream nodes. Set TTL to 0 to disable caching.
      </Text>

      <label style={fieldStyle}>
        <span style={labelStyle}>TTL (seconds):</span>
        <input
          type="number"
          min="0"
          value={ttl}
          onChange={(e) => onConfigChange({ ttl: parseInt(e.target.value) || 0 })}
          placeholder="300"
          style={inputStyle}
        />
        <Text size="xs" c="dimmed" style={descriptionStyle}>
          Default: 300 seconds (5 minutes). Set to 0 to disable caching.
        </Text>
      </label>

      <button
        onClick={async () => {
          onConfigChange({ invalidate: Date.now() })
          await invalidateCache(nodeId)
        }}
        style={buttonStyle}
      >
        🗑️ Invalidate Cache
      </button>

      <div style={inspectorStyle}>
        <Text size="xs" c="dimmed" style={{ fontSize: 9, fontWeight: 600, color: '#888' }}>
          📊 Cache Status
        </Text>

        {status === 'loading' && (
          <Text size="xs" c="dimmed" style={descriptionStyle}>
            Loading cache snapshot…
          </Text>
        )}

        {status !== 'loading' && snapshot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: isCacheValid ? '#4ade80' : '#f87171' }}>
              <span>Status:</span>
              <span style={{ fontWeight: 600 }}>
                {isCacheValid ? '✓ Valid' : '✗ Expired'}
              </span>
            </div>
            <div style={rowStyle}><span>Age:</span><span>{cacheAge}s</span></div>
            <div style={rowStyle}><span>TTL:</span><span>{ttl}s</span></div>
            <div style={rowStyle}><span>Data Type:</span><span>{typeof snapshot.data}</span></div>
            <div style={previewStyle}>
              <Text size="xs" c="dimmed" style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>
                Data Preview:
              </Text>
              <pre style={preStyle}>
                {typeof snapshot.data === 'string'
                  ? snapshot.data.substring(0, 200) + (snapshot.data.length > 200 ? '...' : '')
                  : JSON.stringify(snapshot.data, null, 2).substring(0, 200) + (JSON.stringify(snapshot.data).length > 200 ? '...' : '')}
              </pre>
            </div>
          </div>
        )}

        {status !== 'loading' && !snapshot && (
          <Text size="xs" c="dimmed" style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>
            No cached data yet
          </Text>
        )}
      </div>
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
}

const buttonStyle = {
  padding: '6px 10px',
  background: '#3e3e42',
  color: '#cccccc',
  border: '1px solid #555',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer',
  fontWeight: 600,
}

const inspectorStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: 8,
  background: '#1a1a1a',
  borderRadius: 3,
  border: '1px solid #3e3e42'
}

const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  color: '#cccccc'
}

const previewStyle = {
  marginTop: 4,
  padding: 6,
  background: '#252526',
  borderRadius: 2,
  border: '1px solid #3e3e42',
  maxHeight: 120,
  overflow: 'auto'
}

const preStyle = {
  margin: 0,
  fontSize: 8,
  color: '#cccccc',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
  fontFamily: 'monospace'
}
