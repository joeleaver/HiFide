import { Modal, Tabs, Text, ScrollArea, Group, Badge } from '@mantine/core'
import { DiffEditor } from '@monaco-editor/react'
import { useUiStore } from '../store/ui'

function computeLineDelta(before?: string, after?: string): { added: number; removed: number } {
  const a = (before ?? '').split(/\r?\n/)
  const b = (after ?? '').split(/\r?\n/)
  let i = 0, j = 0
  let added = 0, removed = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    // Heuristics: lookahead by 1 for inserts/deletes
    if (i + 1 < a.length && a[i + 1] === b[j]) { removed++; i++; continue }
    if (j + 1 < b.length && a[i] === b[j + 1]) { added++; j++; continue }
    // Treat as change => one removed and one added
    removed++; added++; i++; j++
  }
  // Remaining tails
  if (i < a.length) removed += (a.length - i)
  if (j < b.length) added += (b.length - j)
  return { added, removed }
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
                <DiffEditor
                  height="580px"
                  original={f.before ?? ''}
                  modified={f.after ?? ''}
                  originalModelPath={`inmemory://modal/${encodeURIComponent(f.path)}?side=original`}
                  modifiedModelPath={`inmemory://modal/${encodeURIComponent(f.path)}?side=modified`}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    renderOverviewRuler: false,
                    overviewRulerBorder: false,
                    overviewRulerLanes: 0,
                    automaticLayout: true,
                    scrollBeyondLastLine: false
                  }}
                  language={undefined}
                />
              </ScrollArea>
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </Modal>
  )
}

