import { memo, useEffect, useCallback, useState } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Button } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'
import Markdown from './Markdown'

interface Props {
  badgeId: string
  resultKey: string
  fullParams?: any
}

export const BadgeKnowledgeBaseStoreContent = memo(function BadgeKnowledgeBaseStoreContent({ badgeId, resultKey, fullParams }: Props) {
  void badgeId

  const [result, setResult] = useState<any>(null)
  const [kbBodies, setKbBodies] = useState<Record<string, string>>({})

  // Ensure result is loaded into local state
  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('tool.getResult', { key: resultKey }).then((res: any) => {
      // tool.getResult returns { ok: true, result: <data> }
      const data = res?.result ?? res?.data ?? res
      setResult(data)
    }).catch(() => {})
  }, [resultKey])

  const pFull: any = fullParams || {}

  const id: string | undefined = pFull.id ? String(pFull.id) : undefined
  const title: string | undefined = pFull.title ? String(pFull.title) : undefined
  const tags: string[] = Array.isArray(pFull.tags) ? pFull.tags : []
  const files: string[] = Array.isArray(pFull.files) ? pFull.files : []
  const descPreview: string | undefined = typeof pFull.description === 'string' ? String(pFull.description).slice(0, 160) : undefined

  const handleLoadBody = useCallback((itemId: string) => {
    const client = getBackendClient(); if (!client) return
    client.rpc('kb.getItemBody', { id: itemId }).then((res: any) => {
      const item = res && typeof res === 'object' ? (res as any).item : undefined
      const body = item && typeof item.body === 'string'
        ? item.body
        : typeof item?.description === 'string'
          ? item.description
          : undefined
      if (typeof body === 'string') setKbBodies((prev) => ({ ...prev, [itemId]: body }))
    }).catch(() => {})
  }, [])

  const resultId: string | undefined = result?.id
  const resultPath: string | undefined = result?.path
  const resultTitle: string | undefined = result?.title
  const resultTags: string[] = Array.isArray(result?.tags) ? result.tags : []
  const resultFiles: string[] = Array.isArray(result?.files) ? result.files : []

  return (
    <Stack gap={12}>
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>Store Parameters</Text>
        <Stack gap={4}>
          {id && (
            <Group gap={6}><Text size="xs" c="dimmed" fw={500}>Id:</Text><Code>{id}</Code></Group>
          )}
          {title && (
            <Group gap={6}><Text size="xs" c="dimmed" fw={500}>Title:</Text><Text size="xs">{title}</Text></Group>
          )}
          {tags.length > 0 && (
            <Group gap={6} wrap="wrap">
              <Text size="xs" c="dimmed" fw={500}>Tags:</Text>
              <Group gap={4}>
                {tags.map((t, i) => <Badge key={i} size="xs" variant="light" color="indigo">{t}</Badge>)}
              </Group>
            </Group>
          )}
          {files.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={500}>Files:</Text>
              <Code block style={{ fontSize: 11, background: '#0d0d0d', border: '1px solid #2d2d2d' }}>
                {files.join('\n')}
              </Code>
            </Stack>
          )}
          {descPreview && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={500}>Description (preview):</Text>
              <Code block style={{ fontSize: 11, lineHeight: 1.4, background: '#0d0d0d', border: '1px solid #2d2d2d' }}>
                {descPreview}
              </Code>
            </Stack>
          )}
        </Stack>
      </div>

      <Divider color="#3d3d3d" />

      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">Result</Text>
          {resultId && <Badge size="xs" variant="light" color="green">{resultId}</Badge>}
        </Group>
        {result ? (
          <Stack gap={8}>
            {resultPath && (
              <Group gap={6}><Text size="xs" c="dimmed" fw={500}>Path:</Text><Text size="xs">{resultPath}</Text></Group>
            )}
            {resultTitle && (
              <Group gap={6}><Text size="xs" c="dimmed" fw={500}>Title:</Text><Text size="xs">{resultTitle}</Text></Group>
            )}
            {resultTags.length > 0 && (
              <Group gap={6} wrap="wrap">
                <Text size="xs" c="dimmed" fw={500}>Tags:</Text>
                <Group gap={4}>
                  {resultTags.map((t: string, i: number) => <Badge key={i} size="xs" variant="light" color="blue">{t}</Badge>)}
                </Group>
              </Group>
            )}
            {resultFiles.length > 0 && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" fw={500}>Files:</Text>
                <Code block style={{ fontSize: 11, background: '#0d0d0d', border: '1px solid #2d2d2d' }}>
                  {resultFiles.join('\n')}
                </Code>
              </Stack>
            )}

            {/* Body expansion */}
            {resultId && (
              <div>
                {kbBodies[resultId] ? (
                  <Markdown content={kbBodies[resultId]} />
                ) : (
                  <Button size="xs" variant="light" color="indigo" onClick={() => handleLoadBody(resultId)}>
                    Load body
                  </Button>
                )}
              </div>
            )}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">No result</Text>
        )}
      </div>
    </Stack>
  )
})

