interface NodeStatusBadgesProps {
  sessionContext?: string
  status?: string
  cacheHit?: boolean
  durationMs?: number
  costUSD?: number
}

export default function NodeStatusBadges({
  sessionContext,
  status,
  cacheHit,
  durationMs,
  costUSD,
}: NodeStatusBadgesProps) {
  const hasAnyBadge = sessionContext || status || cacheHit || durationMs !== undefined || costUSD !== undefined

  if (!hasAnyBadge) return null

  return (
    <div
      style={{
        padding: '6px 10px',
        background: '#252526',
        borderTop: '1px solid #333',
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {sessionContext && sessionContext !== 'in-session' && (
        <span
          style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 10,
            background:
              sessionContext === 'pre-session'
                ? '#6366f1'
                : sessionContext === 'session-init'
                ? '#8b5cf6'
                : sessionContext === 'out-of-session'
                ? '#06b6d4'
                : sessionContext === 'post-session'
                ? '#84cc16'
                : '#64748b',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          {sessionContext === 'pre-session' && '⚙️ PRE'}
          {sessionContext === 'session-init' && '🎬 INIT'}
          {sessionContext === 'out-of-session' && '🔍 OBS'}
          {sessionContext === 'post-session' && '🏁 POST'}
        </span>
      )}
      {status && (
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 10,
            background:
              status === 'executing'
                ? '#4dabf7'
                : status === 'waiting'
                ? '#f59e0b'
                : status === 'completed'
                ? '#10b981'
                : status === 'ok'
                ? '#2e7d32'
                : status === 'warn'
                ? '#f57f17'
                : status === 'blocked'
                ? '#c62828'
                : status === 'masked'
                ? '#6a1b9a'
                : '#2c3e50',
            color: '#ecf0f1',
            fontWeight: status === 'executing' || status === 'waiting' ? 700 : 400,
            animation: status === 'executing' ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {status === 'executing' && '▶️ RUNNING'}
          {status === 'waiting' && '⏸️ WAITING'}
          {status === 'completed' && '✓ DONE'}
          {!['executing', 'waiting', 'completed'].includes(status) && status}
        </span>
      )}
      {cacheHit && (
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 10,
            background: '#1e88e5',
            color: '#ecf0f1',
          }}
        >
          cache
        </span>
      )}
      {typeof durationMs === 'number' && (
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 10,
            background: '#34495e',
            color: '#ecf0f1',
          }}
        >
          {durationMs}ms
        </span>
      )}
      {typeof costUSD === 'number' && (
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 10,
            background: '#3d3d3d',
            color: '#ecf0f1',
          }}
        >
          ${costUSD.toFixed(4)}
        </span>
      )}
    </div>
  )
}

