import { memo, useEffect } from 'react'
import { Stack, Text, Code, Group, Badge, Divider } from '@mantine/core'
import { useDispatch, useAppStore } from '../store'

interface BadgeWorkspaceJumpContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
}

export const BadgeWorkspaceJumpContent = memo(function BadgeWorkspaceJumpContent({
  badgeId,
  searchKey,
  fullParams
}: BadgeWorkspaceJumpContentProps) {
  void badgeId
  const dispatch = useDispatch()

  // Load results from cache into state
  useEffect(() => {
    const existing = (useAppStore as any).getState().feLoadedToolResults?.[searchKey]
    if (existing === undefined) {
      dispatch('loadToolResult', { key: searchKey })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey])

  // Prefer shallow, sanitized params stored in main store to avoid deep snapshot truncation
  const paramsFromStore = useAppStore((s) => (s as any).feToolParamsByKey?.[searchKey])

  // Read results from state
  const data = useAppStore((s) => s.feLoadedToolResults?.[searchKey] || null) as any

  // Extract parameters
  const p = (paramsFromStore as any) || fullParams || {}
  const target = String(p?.target || p?.query || '')
  const expand = p?.expand !== false
  const f = p?.filters || {}
  const languages: string[] = (Array.isArray(f.languages)
    ? f.languages.map((s: any) => String(s))
    : (typeof f.languages === 'string' ? [String(f.languages)] : [])).filter(Boolean)
  const pathsInclude: string[] = (Array.isArray(f.pathsInclude) ? f.pathsInclude.map((s: any) => String(s)) : [])
  const pathsExclude: string[] = (Array.isArray(f.pathsExclude) ? f.pathsExclude.map((s: any) => String(s)) : [])

  const hasPreview = typeof data?.preview === 'string' || (Array.isArray(data?.results) && data.results.length > 0)
  const path = (data && (data.path || data.bestHandle?.path)) as string | undefined
  const lines = (data && (data.lines || data.bestHandle?.lines)) as { start: number; end: number } | undefined

  return (
    <Stack gap={12}>
      {/* Input Parameters Section */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>Jump Parameters</Text>
        <Stack gap={4}>
          {target && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Target:</Text>
              <Text size="xs" c="gray.3">{target}</Text>
            </Group>
          )}
          <Group gap={6}>
            <Text size="xs" c="dimmed" fw={500}>Expand:</Text>
            <Badge size="xs" variant="light" color={expand ? 'green' : 'gray'}>{expand ? 'true' : 'false'}</Badge>
          </Group>
          {languages.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Languages:</Text>
              <Text size="xs" c="gray.3">{languages.join(', ')}</Text>
            </Group>
          )}
          {pathsInclude.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Include:</Text>
              <Text size="xs" c="gray.3">{pathsInclude.join(', ')}</Text>
            </Group>
          )}
          {pathsExclude.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Exclude:</Text>
              <Text size="xs" c="gray.3">{pathsExclude.join(', ')}</Text>
            </Group>
          )}
        </Stack>
      </div>

      <Divider color="#3d3d3d" />

      {/* Results Section */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">Result</Text>
          {hasPreview && (
            <Badge size="xs" variant="light" color="green">preview</Badge>
          )}
          {!hasPreview && (
            <Badge size="xs" variant="light" color="gray">handle only</Badge>
          )}
        </Group>

        {path && (
          <Group gap={6} mb={4}>
            <Text size="xs" fw={500} c="dimmed" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {path}
            </Text>
            {lines && (
              <Badge size="xs" variant="light" color="gray">L{lines.start}-{lines.end}</Badge>
            )}
          </Group>
        )}

        {hasPreview && (
          <Code
            block
            style={{ fontSize: 11, lineHeight: 1.4, maxHeight: 220, overflow: 'auto', background: '#0d0d0d', border: '1px solid #2d2d2d' }}
          >
            {data?.preview || (Array.isArray(data?.results) ? data.results[0]?.content : '')}
          </Code>
        )}

        {/* Top handles */}
        {Array.isArray(data?.topHandles) && data.topHandles.length > 0 && (
          <Stack gap={6} mt={8}>
            <Text size="xs" fw={600} c="dimmed">Top candidates</Text>
            {(data.topHandles as any[]).slice(0, 5).map((h: any, idx: number) => (
              <Group key={idx} gap={6}>
                <Text size="xs" c="gray.3" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h?.path}
                </Text>
                {h?.lines && (
                  <Badge size="xs" variant="light" color="gray">L{h.lines.start}-{h.lines.end}</Badge>
                )}
              </Group>
            ))}
          </Stack>
        )}
      </div>

      {/* Meta */}
      {data?.meta && (
        <Group gap={8} mt={4}>
          <Text size="xs" c="dimmed">{Math.round(data.meta?.elapsedMs ?? 0)}ms</Text>
          {data.meta?.source && (
            <Text size="xs" c="dimmed">• {String(data.meta.source)}</Text>
          )}
        </Group>
      )}
    </Stack>
  )
})

