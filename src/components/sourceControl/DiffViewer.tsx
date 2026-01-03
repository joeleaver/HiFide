import { Box, ScrollArea, Stack, Text, Group, ActionIcon, Textarea, Badge } from '@mantine/core'
import { IconMessagePlus, IconTrash, IconEdit } from '@tabler/icons-react'

import type { GitFileDiff, GitDiffLine } from '../../../shared/git'
import type { DiffAnnotation } from '../../../shared/sourceControlAnnotations'

export type DiffViewerProps = {
  diff: GitFileDiff | null
  annotations: DiffAnnotation[]
  selected?:
    | { kind: 'hunk'; filePath: string; hunkIndex: number }
    | { kind: 'line'; filePath: string; hunkIndex: number; side: 'left' | 'right'; lineOffsetInHunk: number }
    | null

  onSelectHunk: (args: { filePath: string; hunkIndex: number }) => void
  onSelectLine: (args: {
    filePath: string
    hunkIndex: number
    side: 'left' | 'right'
    lineOffsetInHunk: number
  }) => void

  onCreateHunkAnnotation: (args: { filePath: string; hunkIndex: number }) => void
  onCreateLineAnnotation: (args: {
    filePath: string
    hunkIndex: number
    side: 'left' | 'right'
    lineOffsetInHunk: number
  }) => void

  onEditAnnotation: (id: string) => void
  onDeleteAnnotation: (id: string) => void

  onStageFile?: (path: string) => void
  onUnstageFile?: (path: string) => void
}

function lineBg(kind: GitDiffLine['type'], selected: boolean): string {
  if (selected) return '#264f78'
  if (kind === 'add') return '#1b3b1b'
  if (kind === 'del') return '#3b1b1b'
  return 'transparent'
}

function gutterColor(kind: GitDiffLine['type']): string {
  if (kind === 'add') return '#2ea043'
  if (kind === 'del') return '#f85149'
  return '#666'
}

function renderLinePrefix(kind: GitDiffLine['type']): string {
  if (kind === 'add') return '+'
  if (kind === 'del') return '-'
  return ' '
}

function findAnnotationCountForHunk(annotations: DiffAnnotation[], filePath: string, hunkIndex: number): number {
  return annotations.filter((a) => a.anchor.filePath === filePath && a.anchor.kind === 'hunk' && a.anchor.hunkIndex === hunkIndex).length
}

function findAnnotationCountForLine(
  annotations: DiffAnnotation[],
  filePath: string,
  hunkIndex: number,
  side: 'left' | 'right',
  lineOffsetInHunk: number
): number {
  return annotations.filter(
    (a) =>
      a.anchor.filePath === filePath &&
      a.anchor.kind === 'line' &&
      a.anchor.hunkIndex === hunkIndex &&
      a.anchor.side === side &&
      a.anchor.lineOffsetInHunk === lineOffsetInHunk
  ).length
}

export function DiffViewer(props: DiffViewerProps) {
  const diff = props.diff

  if (!diff) {
    return (
      <Box p="md" style={{ color: '#888' }}>
        <Text size="sm">Select a file to view changes.</Text>
      </Box>
    )
  }

  if (diff.isBinary) {
    return (
      <Box p="md" style={{ color: '#888' }}>
        <Text size="sm">Binary file changed (diff not available).</Text>
      </Box>
    )
  }

  return (
    <ScrollArea style={{ height: '100%' }}>
      <Stack gap={0} p={0}>
        <Box px="md" py="sm" style={{ borderBottom: '1px solid #333', background: '#252526' }}>
          <Group justify="space-between">
            <Text size="sm" fw={600} c="white">
              {diff.relativePath}
            </Text>
            <Group gap="xs">
              {diff.hunks.length > 0 && (
                <Badge size="xs" color="gray" variant="light">
                  {diff.hunks.length} hunks
                </Badge>
              )}
            </Group>
          </Group>
        </Box>

        {diff.hunks.map((hunk, hunkIndex) => {
          const isHunkSelected =
            props.selected?.kind === 'hunk' &&
            props.selected.filePath === diff.relativePath &&
            props.selected.hunkIndex === hunkIndex

          const hunkAnnCount = findAnnotationCountForHunk(props.annotations, diff.relativePath, hunkIndex)

          return (
            <Box key={`${hunk.header}-${hunkIndex}`} style={{ borderBottom: '1px solid #222' }}>
              <Box
                px="md"
                py={6}
                style={{
                  background: isHunkSelected ? '#264f78' : '#1e1e1e',
                  borderBottom: '1px solid #2a2a2a',
                  cursor: 'pointer',
                }}
                onClick={() => props.onSelectHunk({ filePath: diff.relativePath, hunkIndex })}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                    {hunk.header}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    {hunkAnnCount > 0 && (
                      <Badge size="xs" color="yellow" variant="light">
                        {hunkAnnCount}
                      </Badge>
                    )}
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      color="gray"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onCreateHunkAnnotation({ filePath: diff.relativePath, hunkIndex })
                      }}
                      aria-label="Add hunk comment"
                    >
                      <IconMessagePlus size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Box>

              <Stack gap={0}>
                {hunk.lines.map((line, lineOffsetInHunk) => {
                  const isLineSelected =
                    props.selected?.kind === 'line' &&
                    props.selected.filePath === diff.relativePath &&
                    props.selected.hunkIndex === hunkIndex &&
                    props.selected.side === 'right' &&
                    props.selected.lineOffsetInHunk === lineOffsetInHunk

                  const lineAnnCount = findAnnotationCountForLine(
                    props.annotations,
                    diff.relativePath,
                    hunkIndex,
                    'right',
                    lineOffsetInHunk
                  )

                  return (
                    <Box
                      key={`${hunkIndex}:${lineOffsetInHunk}`}
                      px="md"
                      py={2}
                      style={{
                        display: 'flex',
                        gap: 10,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: 12,
                        lineHeight: '18px',
                        background: lineBg(line.type, isLineSelected),
                        cursor: 'pointer',
                      }}
                      onClick={() =>
                        props.onSelectLine({
                          filePath: diff.relativePath,
                          hunkIndex,
                          side: 'right',
                          lineOffsetInHunk,
                        })
                      }
                    >
                      <Box style={{ width: 6, height: 18, background: gutterColor(line.type), flexShrink: 0, borderRadius: 2 }} />
                      <Box style={{ width: 24, color: '#666', textAlign: 'right', flexShrink: 0 }}>
                        {line.oldLineNumber ?? ''}
                      </Box>
                      <Box style={{ width: 24, color: '#666', textAlign: 'right', flexShrink: 0 }}>
                        {line.newLineNumber ?? ''}
                      </Box>
                      <Box style={{ width: 14, color: '#888', flexShrink: 0 }}>{renderLinePrefix(line.type)}</Box>
                      <Box style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, color: '#ddd' }}>
                        {line.text}
                      </Box>
                      <Group gap={6} style={{ flexShrink: 0 }}>
                        {lineAnnCount > 0 && (
                          <Badge size="xs" color="yellow" variant="light">
                            {lineAnnCount}
                          </Badge>
                        )}
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="gray"
                          onClick={(e) => {
                            e.stopPropagation()
                            props.onCreateLineAnnotation({
                              filePath: diff.relativePath,
                              hunkIndex,
                              side: 'right',
                              lineOffsetInHunk,
                            })
                          }}
                          aria-label="Add line comment"
                        >
                          <IconMessagePlus size={16} />
                        </ActionIcon>
                      </Group>
                    </Box>
                  )
                })}
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </ScrollArea>
  )
}

export type AnnotationEditorProps = {
  annotation: DiffAnnotation | null
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
}

export function AnnotationEditor(props: AnnotationEditorProps) {
  if (!props.annotation) {
    return (
      <Box p="md" style={{ color: '#888' }}>
        <Text size="sm">Select a line/hunk and add a comment.</Text>
      </Box>
    )
  }

  const title =
    props.annotation.anchor.kind === 'hunk'
      ? `Hunk comment • #${props.annotation.anchor.hunkIndex + 1}`
      : `Line comment • ${props.annotation.anchor.side} • offset ${props.annotation.anchor.lineOffsetInHunk}`

  return (
    <Stack gap="sm" p="md" style={{ height: '100%' }}>
      <Group justify="space-between">
        <Text size="sm" fw={600} c="white">
          {title}
        </Text>
        <Group gap={6}>
          <ActionIcon variant="subtle" color="gray" onClick={props.onSave} aria-label="Save annotation">
            <IconEdit size={16} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="red" onClick={props.onDelete} aria-label="Delete annotation">
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Group>
      <Textarea
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        minRows={8}
        autosize
        placeholder="Describe what you want the model to change here…"
        styles={{
          input: {
            background: '#1e1e1e',
            color: '#ddd',
            borderColor: '#333',
          },
        }}
      />
      <Group justify="flex-end">
        <ActionIcon variant="subtle" color="gray" onClick={props.onCancel} aria-label="Cancel editing">
          <Text size="xs" c="dimmed">
            Cancel
          </Text>
        </ActionIcon>
      </Group>
    </Stack>
  )
}
