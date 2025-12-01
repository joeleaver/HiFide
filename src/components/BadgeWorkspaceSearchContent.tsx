import { memo, useEffect, useState } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeWorkspaceSearchContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
  previewKey?: string
}

export type SearchMatch = {
  path: string
  lineNumber: number
  line: string
}

export type WorkspaceSearchResult = {
  results: SearchMatch[]
  count: number
  summary: string
  meta: { elapsedMs: number; filesMatched: number; truncated: boolean }
}

/**
 * Workspace search results content for expandable tool badges
 * Displays search results grouped by file with line numbers and matched lines
 */
export const BadgeWorkspaceSearchContent = memo(function BadgeWorkspaceSearchContent({
  badgeId,
  searchKey,
  fullParams
}: BadgeWorkspaceSearchContentProps) {
  void badgeId

  // Local state for results
  const [results, setResults] = useState<WorkspaceSearchResult | null>(null)

  // Load results via WS
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    client.rpc('tool.getResult', { key: searchKey }).then((res: any) => {
      // tool.getResult returns { ok: true, result: <data> }
      const data = res?.result ?? res?.data ?? res
      setResults(data as WorkspaceSearchResult)
    }).catch(() => {})
  }, [searchKey])

  if (!results) {
    return (
      <Text size="sm" c="dimmed">
        Loading results...
      </Text>
    )
  }

  // Extract query from fullParams
  const query = fullParams?.query || ''
  const filters = fullParams?.filters || {}
  const pathsInclude = filters.pathsInclude || []
  const pathsExclude = filters.pathsExclude || []
  const maxResults = filters.maxResults

  // Group results by file
  const fileGroups = new Map<string, SearchMatch[]>()
  for (const match of results.results || []) {
    if (!fileGroups.has(match.path)) {
      fileGroups.set(match.path, [])
    }
    fileGroups.get(match.path)!.push(match)
  }

  return (
    <Stack gap={12}>
      {/* Input Parameters Section */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>
          Search Parameters
        </Text>
        <Stack gap={4}>
          {query && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Query:</Text>
              <Text size="xs" c="gray.3">{query}</Text>
            </Group>
          )}
          {maxResults !== undefined && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Max results:</Text>
              <Text size="xs" c="gray.3">{maxResults}</Text>
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
          <Text size="xs" fw={600} c="dimmed">
            Results
          </Text>
          <Badge size="xs" variant="light" color="green">
            {results.count} {results.count === 1 ? 'match' : 'matches'}
          </Badge>
          <Badge size="xs" variant="light" color="blue">
            {fileGroups.size} {fileGroups.size === 1 ? 'file' : 'files'}
          </Badge>
          {results.meta?.truncated && (
            <Badge size="xs" variant="light" color="orange">
              truncated
            </Badge>
          )}
        </Group>

        {results.count === 0 ? (
          <Text size="sm" c="dimmed">
            No matches found
          </Text>
        ) : (
          <Accordion
            variant="separated"
            styles={{
              item: {
                background: '#1a1a1a',
                border: '1px solid #2d2d2d',
              },
              control: {
                padding: '8px 12px',
              },
              content: {
                padding: '8px 12px',
              },
            }}
          >
            {Array.from(fileGroups.entries()).map(([filePath, matches], idx) => (
              <Accordion.Item key={idx} value={`file-${idx}`}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text size="xs" fw={500} c="gray.3" style={{ flex: 1 }}>
                      {filePath}
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                      {matches.length} {matches.length === 1 ? 'match' : 'matches'}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={6}>
                    {matches.map((match, matchIdx) => (
                      <div key={matchIdx}>
                        <Group gap={6} mb={4}>
                          <Badge size="xs" variant="light" color="blue">
                            Line {match.lineNumber}
                          </Badge>
                        </Group>
                        <Code
                          block
                          style={{
                            fontSize: 11,
                            lineHeight: 1.4,
                            background: '#0d0d0d',
                            border: '1px solid #2d2d2d',
                            padding: '6px 8px',
                          }}
                        >
                          {match.line}
                        </Code>
                      </div>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </div>

      {/* Meta Information */}
      <Group gap={8} mt={4}>
        <Text size="xs" c="dimmed">
          {Math.round(results.meta?.elapsedMs ?? 0)}ms
        </Text>
        <Text size="xs" c="dimmed">
          • ripgrep
        </Text>
      </Group>
    </Stack>
  )
})

