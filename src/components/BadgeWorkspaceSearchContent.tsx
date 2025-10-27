import { memo, useEffect } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion } from '@mantine/core'
import { useDispatch, useAppStore } from '../store'

interface BadgeWorkspaceSearchContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
}

export type SearchResultHit = {
  type: 'SNIPPET' | 'AST' | 'FILE'
  path: string
  lines?: { start: number; end: number }
  score: number
  preview: string
  language?: string
  reasons: string[]
  matchedQueries?: string[]
  handle: string
}

export type WorkspaceSearchResult = {
  results: SearchResultHit[]
  summary: string[]
  meta: { elapsedMs: number; strategiesUsed: string[]; truncated: boolean }
}

/**
 * Workspace search results content for expandable tool badges
 * Displays:
 * 1. Full input parameters (queries, mode, filters)
 * 2. Search results with code snippets
 */
export const BadgeWorkspaceSearchContent = memo(function BadgeWorkspaceSearchContent({
  badgeId,
  searchKey,
  fullParams
}: BadgeWorkspaceSearchContentProps) {
  void badgeId

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

  // Prefer shallow, sanitized params stored in main store to avoid deep snapshot truncation
  const paramsFromStore = useAppStore((s) => (s as any).feToolParamsByKey?.[searchKey])

  // Read results from state
  const results = useAppStore((s) => s.feLoadedToolResults?.[searchKey] || null)

  if (!results) {
    return (
      <Text size="sm" c="dimmed">
        No results found
      </Text>
    )
  }

  // Extract queries and normalize filters (prefer shallow params, but fall back to fullParams when store.queries is empty)
  const pStore: any = paramsFromStore as any
  const pFull: any = fullParams || {}

  // Prefer non-empty queries[] from store; otherwise fall back to single query or queries[] from full params
  const queriesRawStore: any[] = Array.isArray(pStore?.queries) ? pStore.queries : []
  const queriesRawFull: any[] = Array.isArray(pFull?.queries) ? pFull.queries : (pFull?.query ? [pFull.query] : [])
  const queriesRaw: any[] = (queriesRawStore && queriesRawStore.length > 0) ? queriesRawStore : queriesRawFull

  const isMaxDepthToken = (s: any) => typeof s === 'string' && s.startsWith('[Max Depth Exceeded')
  const queries = queriesRaw.map((s: any) => String(s || '')).filter(Boolean).filter((s: string) => !isMaxDepthToken(s))

  // Merge filter/mode from store first (sanitized), then fall back to full params
  const mode = pStore?.mode || pFull?.mode || 'auto'
  const f = pStore?.filters || pFull?.filters || {}
  const languages: string[] = (Array.isArray(f.languages)
    ? f.languages.map((s: any) => String(s))
    : (typeof f.languages === 'string' ? [String(f.languages)] : [])).filter((s: string) => !isMaxDepthToken(s))
  const pathsInclude: string[] = (Array.isArray(f.pathsInclude)
    ? f.pathsInclude.map((s: any) => String(s))
    : []).filter((s: string) => !isMaxDepthToken(s))
  const pathsExclude: string[] = (Array.isArray(f.pathsExclude)
    ? f.pathsExclude.map((s: any) => String(s))
    : []).filter((s: string) => !isMaxDepthToken(s))

  return (
    <Stack gap={12}>
      {/* Input Parameters Section */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>
          Search Parameters
        </Text>
        <Stack gap={4}>
          {queries.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Queries:</Text>
              <Text size="xs" c="gray.3">{queries.join(' | ')}</Text>
            </Group>
          )}
          <Group gap={6}>
            <Text size="xs" c="dimmed" fw={500}>Mode:</Text>
            <Badge size="xs" variant="light" color="blue">{mode}</Badge>
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
          <Text size="xs" fw={600} c="dimmed">
            Results
          </Text>
          <Badge size="xs" variant="light" color="green">
            {Array.isArray(results.results) ? results.results.length : 0} {(Array.isArray(results.results) && results.results.length === 1) ? 'match' : 'matches'}
          </Badge>
          {results.meta?.truncated && (
            <Badge size="xs" variant="light" color="orange">
              truncated
            </Badge>
          )}
        </Group>

        {Array.isArray(results.results) && results.results.length === 0 ? (
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
            {(Array.isArray(results.results) ? results.results.slice(0, 10) : []).map((hit: any, idx: number) => (
              <Accordion.Item key={idx} value={`result-${idx}`}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text size="xs" fw={500} c="gray.3" style={{ flex: 1 }}>
                      {hit.path}
                    </Text>
                    {hit.lines && (
                      <Badge size="xs" variant="light" color="gray">
                        L{hit.lines.start}-{hit.lines.end}
                      </Badge>
                    )}
                    {hit.language && (
                      <Badge size="xs" variant="light" color="blue">
                        {hit.language}
                      </Badge>
                    )}
                    {typeof hit.score === 'number' && (
                      <Badge size="xs" variant="light" color="grape">
                        {hit.score.toFixed(2)}
                      </Badge>
                    )}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={8}>
                    {hit.matchedQueries && hit.matchedQueries.length > 0 && (
                      <Group gap={4}>
                        <Text size="xs" c="dimmed">Matched:</Text>
                        {hit.matchedQueries.map((q: string, i: number) => (
                          <Badge key={i} size="xs" variant="dot" color="green">
                            {q}
                          </Badge>
                        ))}
                      </Group>
                    )}
                    {hit.reasons && hit.reasons.length > 0 && (
                      <Group gap={4}>
                        <Text size="xs" c="dimmed">Reasons:</Text>
                        {hit.reasons.map((r: string, i: number) => (
                          <Badge key={i} size="xs" variant="light" color="gray">
                            {r}
                          </Badge>
                        ))}
                      </Group>
                    )}
                    <Code
                      block
                      style={{
                        fontSize: 11,
                        lineHeight: 1.4,
                        maxHeight: 200,
                        overflow: 'auto',
                        background: '#0d0d0d',
                        border: '1px solid #2d2d2d',
                      }}
                    >
                      {hit.preview}
                    </Code>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}

        {Array.isArray(results.results) && results.results.length > 10 && (
          <Text size="xs" c="dimmed" mt={8}>
            Showing first 10 of {results.results.length} results
          </Text>
        )}
      </div>

      {/* Meta Information */}
      <Group gap={8} mt={4}>
        <Text size="xs" c="dimmed">
          {Math.round(results.meta?.elapsedMs ?? 0)}ms
        </Text>
        {Array.isArray(results.meta?.strategiesUsed) && results.meta!.strategiesUsed.length > 0 && (
          <Text size="xs" c="dimmed">
            • {results.meta!.strategiesUsed.join(', ')}
          </Text>
        )}
      </Group>
    </Stack>
  )
})

