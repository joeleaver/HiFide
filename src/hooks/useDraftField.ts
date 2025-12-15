import { useCallback, useMemo, useRef, useState } from 'react'

export interface UseDraftFieldOptions {
  /**
   * When true, local edits will commit to the external store via onCommit.
   * Default: true
   */
  commitEnabled?: boolean

  /**
   * When provided, commits are debounced by this many ms.
   * If undefined, commits happen immediately on change.
   */
  debounceMs?: number
}

/**
 * Draft/commit helper for text inputs where external state updates can cause re-renders
 * that disrupt editing UX (e.g., caret jumps in controlled textareas).
 *
 * Design goals:
 * - Keep typing fully local (draft state) for smooth UX.
 * - Commit changes outward via a single callback (store action), optionally debounced.
 * - Avoid useEffect-based "mirror props into state" patterns; external sync is handled
 *   synchronously when the hook observes a different external value and the user is
 *   not actively editing.
 */
export function useDraftField(externalValue: string, onCommit: (next: string) => void, options?: UseDraftFieldOptions) {
  const commitEnabled = options?.commitEnabled ?? true
  const debounceMs = options?.debounceMs

  const [draft, setDraft] = useState<string>(externalValue)

  // Track the last external value we saw.
  const lastExternalRef = useRef<string>(externalValue)

  // Track whether the user is actively editing (focused).
  const isEditingRef = useRef<boolean>(false)

  // Debounce machinery without useEffect.
  const commitTimerRef = useRef<number | null>(null)

  // External sync (no useEffect): if external changes and user isn't editing, adopt it.
  if (externalValue !== lastExternalRef.current) {
    lastExternalRef.current = externalValue
    if (!isEditingRef.current) {
      // Safe to overwrite draft only when not actively editing.
      // This handles hydration/template loads.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      // (We are not conditionally calling hooks; only calling setState conditionally.)
      //
      // Note: setDraft in render is safe in React 18; it will schedule an update.
      // It is guarded and should be rare.
      setDraft(externalValue)
    }
  }

  const flush = useCallback(() => {
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    if (!commitEnabled) return
    onCommit(draft)
  }, [commitEnabled, draft, onCommit])

  const commit = useCallback(
    (next: string) => {
      if (!commitEnabled) return
      if (debounceMs == null) {
        onCommit(next)
        return
      }
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current)
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null
        onCommit(next)
      }, debounceMs)
    },
    [commitEnabled, debounceMs, onCommit]
  )

  const onChange = useCallback(
    (next: string) => {
      setDraft(next)
      commit(next)
    },
    [commit]
  )

  const onFocus = useCallback(() => {
    isEditingRef.current = true
  }, [])

  const onBlur = useCallback(() => {
    isEditingRef.current = false
    // On blur, flush any pending debounced commit.
    flush()
    // Also adopt any external value that changed while editing.
    if (externalValue !== lastExternalRef.current) {
      lastExternalRef.current = externalValue
      setDraft(externalValue)
    }
  }, [externalValue, flush])

  return useMemo(
    () => ({
      draft,
      setDraft,
      onChange,
      onFocus,
      onBlur,
      flush,
    }),
    [draft, flush, onBlur, onChange, onFocus]
  )
}
