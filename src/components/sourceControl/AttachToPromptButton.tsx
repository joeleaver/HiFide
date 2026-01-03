import { memo } from 'react'

export const AttachToPromptButton = memo(function AttachToPromptButton(props: {
  onAttach: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={props.onAttach}
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.92)',
        fontSize: 12,
        cursor: 'pointer'
      }}
    >
      {props.label || 'Attach annotated diffs to next prompt'}
    </button>
  )
})

