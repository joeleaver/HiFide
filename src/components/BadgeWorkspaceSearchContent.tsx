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
      {/* Parameter Summary */}
      {(maxResults !== undefined || pathsInclude.length || pathsExclude.length) && (
        <Group gap={12} wrap="wrap" p="8px 12px" style={{ background: '#1a1a1a', borderRadius: 6, border: '1px solid #2d2d2d' }}>
          {maxResults !== undefined && (
            <Group gap={4}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts="0.02em">Limit:</Text>
              <Text size="xs" c="gray.4" fw={500}>{maxResults}</Text>
            </Group>
          )}
          {pathsInclude.length > 0 && (
            <Group gap={4}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts="0.02em">Include:</Text>
              <Code size="xs" style={{ background: 'transparent', color: '#888', padding: 0 }}>
                {pathsInclude.join(', ')}
              </Code>
            </Group>
          )}
          {pathsExclude.length > 0 && (
            <Group gap={4}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts="0.02em">Exclude:</Text>
              <Code size="xs" style={{ background: 'transparent', color: '#888', padding: 0 }}>
                {pathsExclude.join(', ')}
              </Code>
            </Group>
          )}
        </Group>
      )}

      {/* Results Header */}
      <Group justify="space-between" align="center" mt={4} px={4}>
        <Group gap={8}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts="0.05em">
            Results
          </Text>
          {llmResult && (
            <Group gap={6}>
              <Badge size="xs" variant="filled" color="gray.8" c="gray.4" fw={600} radius="sm">
                {llmMatchCount} {llmMatchCount === 1 ? 'match' : 'matches'}
              </Badge>
              <Badge size="xs" variant="filled" color="gray.8" c="gray.4" fw={600} radius="sm">
                {llmFileCount} {llmFileCount === 1 ? 'file' : 'files'}
              </Badge>
            </Group>
          )}
        </Group>
        
        {llmResult?.summary && (
          <Text size="xs" c="dimmed" fs="italic">
            {llmResult.summary}
          </Text>
        )}
      </Group>

      {/* Main Results Section */}
      <Stack gap={12}>
        {!llmResult ? (
          <Text size="xs" c="dimmed" px={4}>
            No tool payload recorded.
          </Text>
        ) : llmResult.error ? (
          <Text size="xs" color="red.7" px={4}>
            {llmResult.error}
          </Text>
        ) : llmFiles.length === 0 ? (
          <Text size="xs" c="dimmed" px={4}>
            No matches found.
          </Text>
        ) : (
          <Accordion
            variant="separated"
            styles={{
              item: {
                background: '#141414',
                border: '1px solid #2d2d2d',
                borderRadius: 6,
                overflow: 'hidden',
              },
              control: {
                padding: '8px 12px',
                '&:hover': {
                  background: '#1a1a1a',
                }
              },
              content: {
                padding: '0 12px 12px 12px',
                background: '#0d0d0d',
              },
              chevron: {
                color: '#555',
              }
            }}
          >
            {llmFiles.map((entry, idx) => (
              <Accordion.Item key={`${entry.file}-${idx}`} value={`llm-${idx}`}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text size="xs" fw={600} c="gray.3" style={{ flex: 1, fontFamily: 'var(--mantine-font-family-monospace)' }}>
                      {entry.file}
                    </Text>
                    <Badge size="xs" variant="light" color="gray" radius="sm">
                      {entry.matches?.length || 0}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={4} mt={8}>
                    {(entry.matches || []).map((match, matchIdx) => (
                      <Code
                        key={matchIdx}
                        block
                        style={{
                          fontSize: 11,
                          lineHeight: 1.5,
                          background: '#111',
                          border: '1px solid #222',
                          color: '#ccc',
                          padding: '8px 10px',
                          borderRadius: 4,
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
          <Accordion variant="subtle" mt={4}>
            <Accordion.Item value="raw" style={{ border: 'none' }}>
              <Accordion.Control p="4px 8px">
                <Text size="xs" fw={600} c="dimmed" ta="center">
                  Show Raw JSON Output
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Code
                  block
                  style={{
                    fontSize: 10,
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
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
      </Stack>

      {searchKey && (
        <Stack gap={0}>
          <Divider color="#313131" my={10} label="Cached UI Preview" labelPosition="center" />
          
          {uiResults && (
            <Group gap={8} mb={8}>
              <Badge size="xs" variant="outline" color="gray">
                {uiResults.count} matches
              </Badge>
              <Badge size="xs" variant="outline" color="gray">
                {uiFileGroups.length} files
              </Badge>
              {uiResults.meta?.truncated && (
                <Badge size="xs" variant="dot" color="orange">
                  truncated
                </Badge>
              )}
            </Group>
          )}

          {uiLoading && (
            <Text size="xs" c="dimmed">Loading preview...</Text>
          )}

          {uiError && !uiLoading && (
            <Text size="xs" color="red.7">{uiError}</Text>
          )}

          {uiResults && !uiLoading && !uiError && (
            <Accordion
              variant="separated"
              styles={{
                item: {
                  background: '#141414',
                  border: '1px solid #282828',
                },
                control: {
                  padding: '6px 10px',
                },
                content: {
                  padding: '6px 10px',
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
          </Stack>
      )}
    </Stack>
  )
})
