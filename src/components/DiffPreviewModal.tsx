import { useRef, useEffect } from 'react'

import { Modal, Tabs, Text, ScrollArea, Group, Badge } from '@mantine/core'
import { DiffEditor } from '@monaco-editor/react'
import { useUiStore } from '../store/ui'

function computeLineDelta(before?: string, after?: string): { added: number; removed: number } {
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

function SafeDiff({ before, after, path }: { before?: string; after?: string; path: string }) {
  const editorRef = useRef<any>(null)
  useEffect(() => {
    return () => {
      try { editorRef.current?.setModel(null) } catch {}
    }
  }, [])
  return (
    <DiffEditor
      height="580px"
      original={before ?? ''}
      modified={after ?? ''}
      originalModelPath={`inmemory://modal/${encodeURIComponent(path)}?side=original`}
      modifiedModelPath={`inmemory://modal/${encodeURIComponent(path)}?side=modified`}
      theme="vs-dark"
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        renderOverviewRuler: false,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        // Prefer focused hunks with small context

        hideUnchangedRegions: { enabled: true, contextLineCount: 3 },

        diffAlgorithm: 'advanced'
      } as any}
      language={undefined}
      onMount={(ed) => { editorRef.current = ed }}
    />
  )
}

export default function DiffPreviewModal() {
  const opened = useUiStore((s) => s.diffPreviewOpen)
  const data = useUiStore((s) => s.diffPreviewData) || []
  const close = useUiStore((s) => s.closeDiffPreview)

  return (
    <Modal opened={opened} onClose={close} title="File changes" size="90%" radius="md">
      {data.length === 0 ? (
        <Text c="dimmed">No diff preview available.</Text>
      ) : (
        <Tabs defaultValue={data[0]?.path} keepMounted={false}>
          <Tabs.List>
            {data.map((f) => {
              const { added, removed } = computeLineDelta(f.before, f.after)
              return (
                <Tabs.Tab key={f.path} value={f.path}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</Text>
                    <Group gap={4} wrap="nowrap">
                      <Badge size="xs" color="green">+{added}</Badge>
                      <Badge size="xs" color="red">-{removed}</Badge>
                      {f.truncated ? <Badge size="xs" color="yellow">truncated</Badge> : null}
                    </Group>
                  </Group>
                </Tabs.Tab>
              )
            })}
          </Tabs.List>
          {data.map((f) => (
            <Tabs.Panel key={f.path} value={f.path}>
              <ScrollArea h={600} mt="sm">
                <SafeDiff before={f.before} after={f.after} path={f.path} />
              </ScrollArea>
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Modal>
  )
}

