import { memo, useEffect } from 'react'
import { Stack, Text, Code, Group, Badge, Divider } from '@mantine/core'
import { useDispatch, useAppStore } from '../store'

interface BadgeSearchContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
}

type SearchResult = {
  path: string
  startLine: number
  endLine: number
  text: string
}

/**
 * Search results content for expandable tool badges
 * Displays code snippets from index.search results
 */
export const BadgeSearchContent = memo(function BadgeSearchContent({
  badgeId,
  searchKey,
  fullParams
}: BadgeSearchContentProps) {
  void badgeId;
  const dispatch = useDispatch()

  // Load results from cache into state
  useEffect(() => {
    // Only request load if we don't already have results for this key
    const existing = (useAppStore as any).getState().feLoadedToolResults?.[searchKey]
    if (existing === undefined) {
      dispatch('loadToolResult', { key: searchKey })
    }
    // Note: do NOT include `dispatch` as a dependency; its identity may change and cause re-runs
  }, [searchKey])

  // Read results from state (avoid [] literal in selector to prevent unnecessary re-renders)
  const loadedResults = useAppStore((s) => s.feLoadedToolResults?.[searchKey])
  const results: SearchResult[] = loadedResults ?? []

  if (!results.length) {
    return (
      <Text size="sm" c="dimmed">
        No results found
      </Text>
    )
  }

  // Extract parameters from fullParams
  const query = fullParams?.query || ''
  const k = fullParams?.k

  return (
    <Stack gap={12}>
      {/* Input Parameters Section */}
      {fullParams && (
        <>
          <div>
            <Text size="xs" fw={600} c="dimmed" mb={6}>
              Search Query
            </Text>
            <Code
              block
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                background: '#1a1a1a',
                border: '1px solid #2d2d2d',
                padding: 8,
              }}
            >
              {query}
            </Code>
            {k !== undefined && (
              <Group gap={6} mt={6}>
                <Text size="xs" c="dimmed" fw={500}>Max results:</Text>
                <Text size="xs" c="gray.3">{k}</Text>
              </Group>
            )}
          </div>
          <Divider color="#3d3d3d" />
        </>
      )}

      {/* Results Section */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">
            Results
          </Text>
          <Badge size="xs" variant="light" color="green">
            {results.length} {results.length === 1 ? 'chunk' : 'chunks'}
          </Badge>
        </Group>

        <Stack gap={8}>
          {results.map((result, idx) => (
            <div key={idx} style={{ borderBottom: idx < results.length - 1 ? '1px solid #3d3d3d' : 'none', paddingBottom: 8 }}>
              <Group gap={6} mb={4}>
                <Text size="xs" fw={500} c="dimmed">
                  {result.path}
                </Text>
                <Badge size="xs" variant="light" color="gray">
                  L{result.startLine}-{result.endLine}
                </Badge>
              </Group>
              <Code
                block
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  maxHeight: 150,
                  overflow: 'auto',
                  background: '#1a1a1a',
                  border: '1px solid #2d2d2d',
                }}
              >
                {result.text}
              </Code>
            </div>
          ))}
        </Stack>
      </div>
    </Stack>
  )
})

