
type Props = {
  message: string
  busy: boolean
  error: string | null
  onChangeMessage: (next: string) => void
  onCommit: () => void
}

export function CommitBox({ message, busy, error, onChangeMessage, onCommit }: Props) {
  const canCommit = !busy && message.trim().length > 0

  return (
    <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          placeholder="Message"
          style={{ flex: 1 }}
        />
        <button disabled={!canCommit} onClick={onCommit}>
          {busy ? 'Committing…' : 'Commit'}
        </button>
      </div>
      {error ? (
        <div style={{ marginTop: 6, color: '#ff6b6b', fontSize: 12 }}>
          {error}
        </div>
      ) : null}
    </div>
  )
}

