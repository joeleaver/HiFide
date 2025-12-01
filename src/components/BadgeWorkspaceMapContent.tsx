import { memo, useEffect, useState } from 'react'
import { Stack, Text, Group, Badge, Divider, Code } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeWorkspaceMapContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
}

export const BadgeWorkspaceMapContent = memo(function BadgeWorkspaceMapContent({
  badgeId,
  searchKey,
  fullParams,
}: BadgeWorkspaceMapContentProps) {
  void badgeId

  const [data, setData] = useState<any>(null)

  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('tool.getResult', { key: searchKey }).then((res: any) => {
      // tool.getResult returns { ok: true, result: <data> }
      const val = res?.result ?? res?.data ?? res
      setData(val)
    }).catch(() => {})
  }, [searchKey])

  const p = fullParams || {}
  const maxPerSection = typeof p?.maxPerSection === 'number' ? p.maxPerSection : undefined

  if (!data) {
    return (
      <Text size="sm" c="dimmed">No map available</Text>
    )
  }

  const sections = Array.isArray(data.sections) ? data.sections : []
  const exampleQueries: string[] = Array.isArray(data.exampleQueries) ? data.exampleQueries : []

  return (
    <Stack gap={12}>
      {/* Input Parameters */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>Map Parameters</Text>
        <Group gap={6}>
          <Text size="xs" c="dimmed" fw={500}>maxPerSection:</Text>
          <Text size="xs" c="gray.3">{typeof maxPerSection === 'number' ? maxPerSection : 'default'}</Text>
        </Group>
      </div>

      <Divider color="#3d3d3d" />

      {/* Sections */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">Sections</Text>
          <Badge size="xs" variant="light" color="green">{sections.length}</Badge>
        </Group>

        <Stack gap={10}>
          {sections.slice(0, 6).map((sec: any, idx: number) => (
            <div key={idx}>
              <Group gap={8} mb={4}>
                <Text size="xs" fw={600} c="gray.2" style={{ flex: 1 }}>{sec.title}</Text>
                <Badge size="xs" variant="light" color="gray">{Array.isArray(sec.items) ? sec.items.length : 0}</Badge>
              </Group>
              {(Array.isArray(sec.items) ? sec.items.slice(0, 8) : []).map((it: any, i: number) => (
                <Group key={i} gap={6}>
                  <Text size="xs" c="gray.3" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.path}
                  </Text>
                  {it?.lines && (
                    <Badge size="xs" variant="light" color="gray">L{it.lines.start}-{it.lines.end}</Badge>
                  )}
                  {it?.handle && (
                    <Badge size="xs" variant="light" color="indigo">handle</Badge>
                  )}
                </Group>
              ))}
              {Array.isArray(sec.items) && sec.items.length > 8 && (
                <Text size="xs" c="dimmed" mt={2}>and {sec.items.length - 8} more…</Text>
              )}
            </div>
          ))}
          {sections.length > 6 && (
            <Text size="xs" c="dimmed">Showing first 6 sections of {sections.length}</Text>
          )}
        </Stack>
      </div>

      {/* Example Queries */}
      {exampleQueries.length > 0 && (
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={6}>Example Queries</Text>
          <Group gap={6}>
            {exampleQueries.slice(0, 10).map((q, i) => (
              <Badge key={i} size="xs" variant="light" color="blue">{q}</Badge>
            ))}
          </Group>
        </div>
      )}

      {/* Root */}
      {data.root && (
        <Group gap={6}>
          <Text size="xs" c="dimmed" fw={500}>Root:</Text>
          <Code style={{ fontSize: 11, background: '#1a1a1a', border: '1px solid #2d2d2d' }}>{String(data.root)}</Code>
        </Group>
      )}
    </Stack>
  )
})

