import { memo, useEffect } from 'react'
import { Text } from '@mantine/core'
import { DiffEditor } from '@monaco-editor/react'

import { useDispatch, useAppStore } from '../store'

interface BadgeDiffContentProps {
  badgeId: string
  diffKey: string
}

export function computeLineDelta(before?: string, after?: string): { added: number; removed: number } {
  const a = (before ?? '').split(/\r?\n/)
  const b = (after ?? '').split(/\r?\n/)
  let i = 0, j = 0, added = 0, removed = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (i + 1 < a.length && a[i + 1] === b[j]) { removed++; i++; continue }
    if (j + 1 < b.length && a[i] === b[j + 1]) { added++; j++; continue }
    removed++; added++; i++; j++
  }
  if (i < a.length) removed += (a.length - i)
  if (j < b.length) added += (b.length - j)
  return { added, removed }
}

export type DiffFile = {
  path: string
  before?: string
  after?: string
  truncated?: boolean
}

// Stable empty array to avoid new reference on each render
const EMPTY_DIFF_LIST: DiffFile[] = []

/**
 * Diff editor content for expandable tool badges
 * Displays the first file's diff inline
 */
export const BadgeDiffContent = memo(function BadgeDiffContent({ badgeId, diffKey }: BadgeDiffContentProps) {
  const dispatch = useDispatch()

  // Load diff from cache into state
  useEffect(() => {
    dispatch('loadToolResult', { key: diffKey })
  }, [diffKey, dispatch])

  // Read diff from state
  const dataFromStore = useAppStore((s) => s.feLoadedToolResults?.[diffKey])
  const data = dataFromStore ?? EMPTY_DIFF_LIST

  if (!data.length) {
    return (
      <Text size="sm" c="dimmed">
        No changes
      </Text>
    )
  }

  const f = data[0]

  return (
    <div>
      {/* Diff editor */}
      <div style={{ height: 200 }}>
        <DiffEditor
          height="200px"
          original={f.before ?? ''}
          modified={f.after ?? ''}
          originalModelPath={`inmemory://badge-diff/${badgeId}/${encodeURIComponent(f.path)}?side=original`}
          modifiedModelPath={`inmemory://badge-diff/${badgeId}/${encodeURIComponent(f.path)}?side=modified`}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: false,
            minimap: { enabled: false },
            renderOverviewRuler: false,
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbers: 'off',
          }}
          language={undefined}
        />
      </div>
    </div>
  )
})

