import type { GitLogCommit } from '../../../shared/gitLog'

export type CommitGraphRow = {
  sha: string
  lane: number
  lanesCount: number
  isMerge: boolean
  parents: string[]
  connectors: Array<{ x1: number; y1: number; x2: number; y2: number }>
}

export type HistoryViewProps = {
  commits: GitLogCommit[]
  graphRows: CommitGraphRow[]
  selectedSha: string | null
  busy: boolean
  error: string | null
  onSelectCommit: (sha: string) => void
  onLoadMore: () => void
  canLoadMore: boolean
}

function GraphColumn(props: { row: CommitGraphRow }) {
  const size = 14
  const gap = 10
  const width = Math.max(1, props.row.lanesCount) * gap
  const cx = props.row.lane * gap + gap / 2
  const cy = size / 2

  // v2: draw connectors within the loaded window.
  // These connectors are best-effort and deterministic for the current page.
  const stroke = 'rgba(255,255,255,0.25)'
  const strokeWidth = 1

  return (
    <div style={{ width, minWidth: width, height: size, display: 'flex', alignItems: 'center' }}>
      <svg width={width} height={size} style={{ display: 'block' }}>
        {props.row.connectors.map((c, idx) => (
          <line
            // eslint-disable-next-line react/no-array-index-key
            key={idx}
            x1={c.x1}
            y1={c.y1}
            x2={c.x2}
            y2={c.y2}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        ))}
        <circle cx={cx} cy={cy} r={props.row.isMerge ? 4 : 3} fill={props.row.isMerge ? '#ffd43b' : '#74c0fc'} />
      </svg>
    </div>
  )
}

export function HistoryView(props: HistoryViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', minWidth: 320 }}>
      <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>HISTORY</div>
        {props.busy ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
        {props.error ? <div style={{ color: '#ff6b6b' }}>{props.error}</div> : null}
        <div style={{ marginLeft: 'auto' }}>
          <button disabled={!props.canLoadMore || props.busy} onClick={props.onLoadMore}>
            Load more
          </button>
        </div>
      </div>

      <div style={{ overflow: 'auto' }}>
        {props.commits.length === 0 && !props.busy ? (
          <div style={{ padding: 12, opacity: 0.7 }}>No commits to show.</div>
        ) : null}

        {props.commits.map((c) => {
          const selected = c.sha === props.selectedSha
          const graphRow = props.graphRows.find((r) => r.sha === c.sha)
          return (
            <div
              key={c.sha}
              onClick={() => props.onSelectCommit(c.sha)}
              style={{
                cursor: 'pointer',
                padding: '8px 10px',
                background: selected ? 'rgba(255,255,255,0.08)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                {graphRow ? <GraphColumn row={graphRow} /> : <div style={{ width: 10 }} />}
                <code style={{ opacity: 0.8 }}>{c.sha.slice(0, 8)}</code>
                <div style={{ fontWeight: 600, flex: 1 }}>{c.subject || '(no subject)'}</div>
              </div>
              {c.refs && c.refs.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {c.refs.slice(0, 6).map((r) => (
                    <span
                      key={r}
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.10)',
                        opacity: 0.95,
                      }}
                    >
                      {r}
                    </span>
                  ))}
                  {c.refs.length > 6 ? <span style={{ fontSize: 11, opacity: 0.7 }}>+{c.refs.length - 6}</span> : null}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8, opacity: 0.75, fontSize: 12, marginTop: 2 }}>
                <div>{c.authorName}</div>
                <div>•</div>
                <div>{c.authorDateIso}</div>
                {c.parents.length > 1 ? (
                  <div style={{ marginLeft: 'auto', opacity: 0.9 }}>merge</div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
