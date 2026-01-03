import type { GitCommitDetails } from '../../../shared/gitCommit'

export type CommitDetailsViewProps = {
  details: GitCommitDetails | null
  busy: boolean
  error: string | null
}

export function CommitDetailsView(props: CommitDetailsViewProps) {
  if (props.busy && !props.details) {
    return <div style={{ padding: 12, opacity: 0.75 }}>Loading commit…</div>
  }

  if (props.error) {
    return <div style={{ padding: 12, color: '#ff6b6b' }}>{props.error}</div>
  }

  if (!props.details) {
    return <div style={{ padding: 12, opacity: 0.75 }}>Select a commit to see details.</div>
  }

  const message = [props.details.subject, props.details.body].filter(Boolean).join('\n\n')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <code style={{ opacity: 0.85 }}>{props.details.sha.slice(0, 8)}</code>
          <div style={{ fontWeight: 700 }}>{props.details.subject || '(no subject)'}</div>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
          {props.details.authorName} &lt;{props.details.authorEmail}&gt; • {props.details.authorDateIso}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', padding: 10 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Message</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', opacity: 0.9 }}>{message || '(empty)'}</pre>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Files ({props.details.files.length})</div>
          {props.details.files.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No files</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {props.details.files.map((f) => (
                <code key={f} style={{ opacity: 0.9 }}>
                  {f}
                </code>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

