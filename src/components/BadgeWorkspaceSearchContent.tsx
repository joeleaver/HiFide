import { memo, useEffect, useMemo, useState } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeWorkspaceSearchContentProps {
  badgeId: string
  searchKey?: string
  fullParams?: any
  llmResult?: WorkspaceSearchMinimalResult | null
}

export type SearchMatch = {
  path: string
  lineNumber: number
  line: string
}

export type WorkspaceSearchUiResult = {
  results: SearchMatch[]
  count: number
  summary: string
  meta: { elapsedMs: number; filesMatched: number; truncated: boolean; mode?: string }
}

type WorkspaceSearchMinimalResult = {
  ok?: boolean
  count?: number
  resultCount?: number
  summary?: string
  results?: Array<{ file: string; matches: string[] }>
  error?: string
}

/**
 * Workspace search results content for expandable tool badges
 * Renders both the exact payload sent to the LLM and, when available,
 * the richer UI preview fetched via previewKey/tool.getResult.
 */
export const BadgeWorkspaceSearchContent = memo(function BadgeWorkspaceSearchContent({
  badgeId,
  searchKey,
  fullParams,
  llmResult
}: BadgeWorkspaceSearchContentProps) {
  void badgeId

  const [uiResults, setUiResults] = useState<WorkspaceSearchUiResult | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiLoading, setUiLoading] = useState(false)

  useEffect(() => {
    if (!searchKey) {
      setUiResults(null)
      setUiError(null)
      setUiLoading(false)
      return
    }

    const client = getBackendClient()
    if (!client) {
      setUiResults(null)
      setUiError('Renderer backend unavailable')
      setUiLoading(false)
      return
    }

    let cancelled = false
    setUiLoading(true)
    setUiError(null)

    client.rpc('tool.getResult', { key: searchKey })
      .then((res: any) => {
        if (cancelled) return
        const data = res?.result ?? res?.data ?? res
        setUiResults(data as WorkspaceSearchUiResult)
      })
      .catch((err: any) => {
        if (cancelled) return
        const message = err?.message ? String(err.message) : 'Failed to load cached preview'
        setUiResults(null)
        setUiError(message)
      })
      .finally(() => {
        if (!cancelled) setUiLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [searchKey])

  // Extract query/filter parameters for display
  const query = fullParams?.query || ''
  const filters = fullParams?.filters || {}
  const pathsInclude = filters.pathsInclude || []
  const pathsExclude = filters.pathsExclude || []
  const maxResults = filters.maxResults

  // Prepare LLM payload data
  const llmFiles = Array.isArray(llmResult?.results) ? llmResult.results : []
  const llmMatchCount = typeof llmResult?.count === 'number'
    ? llmResult.count
    : typeof llmResult?.resultCount === 'number'
      ? llmResult.resultCount
      : llmFiles.reduce((acc, entry) => acc + (Array.isArray(entry.matches) ? entry.matches.length : 0), 0)
  const llmFileCount = llmFiles.length
  const llmRawPayload = llmResult ? JSON.stringify(llmResult, null, 2) : null

  // Group UI payload results by file for accordion view
  const uiFileGroups = useMemo(() => {
    if (!uiResults?.results) return []
    const map = new Map<string, SearchMatch[]>()
    for (const match of uiResults.results) {
      if (!map.has(match.path)) {
        map.set(match.path, [])
      }
      map.get(match.path)!.push(match)
    }
    return Array.from(map.entries())
  }, [uiResults])

  return (
    <Stack gap={12}>
      {(query || maxResults !== undefined || pathsInclude.length || pathsExclude.length) && (
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
      )}

      <Divider color="#3d3d3d" />

      {/* LLM Payload Section */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">
            LLM Payload
          </Text>
          {llmResult && (
            <>
              <Badge size="xs" variant="light" color="green">
                {llmMatchCount} {llmMatchCount === 1 ? 'match' : 'matches'}
              </Badge>
              <Badge size="xs" variant="light" color="blue">
                {llmFileCount} {llmFileCount === 1 ? 'file' : 'files'}
              </Badge>
              {llmResult.error && (
                <Badge size="xs" variant="light" color="red">
                  error
                </Badge>
              )}
            </>
          )}
        </Group>

        {llmResult?.summary && (
          <Text size="xs" c="gray.4" mb={6}>
            {llmResult.summary}
          </Text>
        )}

        {!llmResult ? (
          <Text size="sm" c="dimmed">
            No tool payload was recorded for this call.
          </Text>
        ) : llmResult.error ? (
          <Text size="sm" c="red.4">
            {llmResult.error}
          </Text>
        ) : llmFiles.length === 0 ? (
          <Text size="sm" c="dimmed">
            No matches were returned to the model.
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
            {llmFiles.map((entry, idx) => (
              <Accordion.Item key={`${entry.file}-${idx}`} value={`llm-${idx}`}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text size="xs" fw={500} c="gray.3" style={{ flex: 1 }}>
                      {entry.file}
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                      {entry.matches?.length || 0} {entry.matches?.length === 1 ? 'match' : 'matches'}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={6}>
                    {(entry.matches || []).map((match, matchIdx) => (
                      <Code
                        key={matchIdx}
                        block
                        style={{
                          fontSize: 11,
                          lineHeight: 1.4,
                          background: '#0d0d0d',
                          border: '1px solid #2d2d2d',
                          padding: '6px 8px',
                        }}
                      >
                        {match}
                      </Code>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}

        {llmRawPayload && (
          <Stack gap={4} mt={10}>
            <Text size="xs" fw={600} c="dimmed">
              Raw payload sent to model
            </Text>
            <Code
              block
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                maxHeight: 200,
                overflow: 'auto',
                background: '#0d0d0d',
                border: '1px solid #2d2d2d',
                padding: '8px 10px',
              }}
            >
              {llmRawPayload}
            </Code>
          </Stack>
        )}
      </div>

      {searchKey && (
        <>
          <Divider color="#3d3d3d" />
          <div>
            <Group gap={8} mb={6}>
              <Text size="xs" fw={600} c="dimmed">
                Cached UI Preview
              </Text>
              {uiResults && (
                <>
                  <Badge size="xs" variant="light" color="green">
                    {uiResults.count} {uiResults.count === 1 ? 'match' : 'matches'}
                  </Badge>
                  <Badge size="xs" variant="light" color="blue">
                    {uiFileGroups.length} {uiFileGroups.length === 1 ? 'file' : 'files'}
                  </Badge>
                  {uiResults.meta?.truncated && (
                    <Badge size="xs" variant="light" color="orange">
                      truncated
                    </Badge>
                  )}
                  {uiResults.meta?.mode && (
                    <Badge size="xs" variant="light" color="gray">
                      {uiResults.meta.mode}
                    </Badge>
                  )}
                </>
              )}
            </Group>

            {uiLoading && (
              <Text size="sm" c="dimmed">
                Loading cached preview...
              </Text>
            )}

            {uiError && !uiLoading && (
              <Text size="sm" c="red.4">
                {uiError}
              </Text>
            )}

            {!uiLoading && !uiError && !uiResults && (
              <Text size="sm" c="dimmed">
                No cached preview available.
              </Text>
            )}

            {uiResults && !uiLoading && !uiError && (
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
                {uiFileGroups.map(([filePath, matches], idx) => (
                  <Accordion.Item key={`${filePath}-${idx}`} value={`ui-${idx}`}>
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
        </>
      )}
    </Stack>
  )
})
