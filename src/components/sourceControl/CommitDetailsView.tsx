import type { GitFileDiff } from '../../../shared/git'
import type { GitCommitDetails } from '../../../shared/gitCommit'
import { DiffViewer } from './DiffViewer'

export type CommitDetailsViewProps = {
  details: GitCommitDetails | null
  busy: boolean
  error: string | null
  selectedFile: string | null
  diff: GitFileDiff | null
  onSelectFile: (path: string) => void
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

        <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 10 }}>
          <div style={{ width: 240, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Files ({props.details.files.length})</div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {props.details.files.length === 0 ? (
                <div style={{ opacity: 0.75 }}>No files</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {props.details.files.map((f) => {
                    const isSelected = f === props.selectedFile
                    return (
                      <div
                        key={f}
                        onClick={() => props.onSelectFile(f)}
                        style={{
                          cursor: 'pointer',
                          padding: '4px 6px',
                          background: isSelected ? 'rgba(255,255,255,0.08)' : 'transparent',
                          borderRadius: 4,
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={f}
                      >
                        <code style={{ opacity: isSelected ? 1 : 0.8 }}>{f}</code>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
             <div style={{ fontWeight: 700, marginBottom: 6 }}>Diff {props.selectedFile ? `- ${props.selectedFile}` : ''}</div>
             <div style={{ flex: 1, border: '1px solid rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
                {props.diff ? (
                  <DiffViewer diff={props.diff} />
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13 }}>
                    {props.selectedFile ? 'Loading diff...' : 'Select a file to view diff'}
                  </div>
                )}
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}

