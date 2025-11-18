import { memo, useEffect, useState } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeWorkspaceSearchContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
  previewKey?: string
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

  // Local state for results
  const [results, setResults] = useState<any>(null)

  // Load results via WS
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    client.rpc('tool.getResult', { key: searchKey }).then((res: any) => {
      const data = res && typeof res === 'object' && 'data' in res ? (res as any).data : res
      setResults(data)
    }).catch(() => {})
  }, [searchKey])

  if (!results) {
    return (
      <Text size="sm" c="dimmed">
        Loading results...
      </Text>
    )
  }

  // Extract queries and normalize filters (fall back to fullParams and usedParams from results)
  const pFull: any = fullParams || {}
  const pUsed: any = (results as any).usedParams || {}

  // Prefer non-empty queries[] from store; otherwise fall back to single query or queries[] from full/used params
  const queriesRawFull: any[] = Array.isArray(pFull?.queries) ? pFull.queries : (pFull?.query ? [pFull.query] : [])
  const queriesRawUsed: any[] = Array.isArray(pUsed?.queries) ? pUsed.queries : (pUsed?.query ? [pUsed.query] : [])
  const queriesRaw: any[] = (queriesRawFull && queriesRawFull.length > 0 ? queriesRawFull : queriesRawUsed)

  const isMaxDepthToken = (s: any) => typeof s === 'string' && s.startsWith('[Max Depth Exceeded')
  const queries = queriesRaw.map((s: any) => String(s || '')).filter(Boolean).filter((s: string) => !isMaxDepthToken(s))

  // Merge filter/mode from full params, then usedParams (normalized defaults)
  const mode = pFull?.mode || pUsed?.mode || 'auto'
  const f = pFull?.filters || pUsed?.filters || {}
  const languages: string[] = (Array.isArray(f.languages)
    ? f.languages.map((s: any) => String(s))
    : (typeof f.languages === 'string' ? [String(f.languages)] : [])).filter((s: string) => !isMaxDepthToken(s))
  const pathsInclude: string[] = (Array.isArray(f.pathsInclude)
    ? f.pathsInclude.map((s: any) => String(s))
    : []).filter((s: string) => !isMaxDepthToken(s))
  const pathsExclude: string[] = (Array.isArray(f.pathsExclude)
    ? f.pathsExclude.map((s: any) => String(s))
    : []).filter((s: string) => !isMaxDepthToken(s))
  const k = typeof f.maxResults === 'number' ? f.maxResults : undefined
  const linesClamp = typeof f.maxSnippetLines === 'number' ? f.maxSnippetLines : undefined
  const action = pUsed?.action

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
          {k !== undefined && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Max results:</Text>
              <Text size="xs" c="gray.3">{k}</Text>
            </Group>
          )}
          {linesClamp !== undefined && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Snippet lines:</Text>
              <Text size="xs" c="gray.3">{linesClamp}</Text>
            </Group>
          )}
          {action && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Action:</Text>
              <Badge size="xs" variant="light" color="grape">{action}</Badge>
            </Group>
          )}

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

