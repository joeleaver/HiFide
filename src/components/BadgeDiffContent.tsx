import { memo, useEffect, useRef, useState } from 'react'
import { Text, Button } from '@mantine/core'
import { DiffEditor } from '@monaco-editor/react'

import { useUiStore } from '../store/ui'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeDiffContentProps {
  badgeId: string
  diffKey: string
}

export function computeLineDelta(before?: string, after?: string): { added: number; removed: number } {
  const a = (before ?? '').split(/\r?\n/)
  const b = (after ?? '').split(/\r?\n/)
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return { added: 0, removed: 0 }
  const LIMIT = 1_000_000
  if (n * m > LIMIT) {
    let i = 0, j = 0
    while (i < n && j < m && a[i] === b[j]) { i++; j++ }
    return { added: (m - j), removed: (n - i) }
  }
  let prev = new Uint32Array(m + 1)
  let curr = new Uint32Array(m + 1)
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1]
    for (let j = 1; j <= m; j++) {
      curr[j] = ai === b[j - 1] ? (prev[j - 1] + 1) : (prev[j] > curr[j - 1] ? prev[j] : curr[j - 1])
    }
    const tmp = prev; prev = curr; curr = tmp
    curr.fill(0)
  }
  const lcs = prev[m]
  return { added: m - lcs, removed: n - lcs }
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
  const openDiffPreview = useUiStore((s) => s.openDiffPreview)

  // Local state for diff list
  const [data, setData] = useState<DiffFile[]>(EMPTY_DIFF_LIST)

  // Load diff via WS (from main-owned cache)
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    client.rpc('tool.getResult', { key: diffKey }).then((res: any) => {
      // tool.getResult returns { ok: true, result: <data> }
      const val = res?.result ?? res?.data ?? res
      const arr = Array.isArray(val) ? (val as DiffFile[]) : []
      setData(arr)
    }).catch(() => {})
  }, [diffKey])

  // Ensure Monaco diff editor detaches models on unmount to avoid disposal errors
  const editorRef = useRef<any>(null)
  useEffect(() => {
    return () => {
      try { editorRef.current?.setModel(null) } catch {}
    }
  }, [])

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
            // Prefer focused hunks with small context

            hideUnchangedRegions: { enabled: true, contextLineCount: 3 },

            diffAlgorithm: 'advanced',
          } as any}
          language={undefined}
          onMount={(ed) => { editorRef.current = ed }}
        />
      </div>
      {Array.isArray(data) && data.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <Button size="xs" variant="light" onClick={() => openDiffPreview(data as any)}>
            Open all {data.length} files
          </Button>
        </div>
      )}
    </div>
  )
})

