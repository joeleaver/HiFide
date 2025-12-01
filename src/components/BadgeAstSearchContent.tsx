import { memo, useEffect, useState } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeAstSearchContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
}

export type AstGrepMatch = {
  filePath: string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  snippet: string
  text: string
}

export type AstSearchResult = {
  matches: AstGrepMatch[]
  truncated: boolean
  stats: {
    scannedFiles: number
    matchedCount: number
    durationMs: number
  }
}

/**
 * AST search results content for expandable tool badges
 * Displays:
 * 1. Full input parameters (pattern, languages, filters)
 * 2. AST search results with code snippets
 */
export const BadgeAstSearchContent = memo(function BadgeAstSearchContent({
  badgeId,
  searchKey,
  fullParams
}: BadgeAstSearchContentProps) {
  void badgeId

  // Local results
  const [results, setResults] = useState<any>(null)

  // Load results via WS
  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('tool.getResult', { key: searchKey }).then((res: any) => {
      // tool.getResult returns { ok: true, result: <data> }
      const data = res?.result ?? res?.data ?? res
      setResults(data)
    }).catch(() => {})
  }, [searchKey])

  if (!results || !results.matches) {
    return (
      <Text size="sm" c="dimmed">
        No results found
      </Text>
    )
  }

  // Extract parameters from badge metadata fallback
  const params = fullParams || {}
  const pattern = params?.pattern || ''
  const languages = Array.isArray(params?.languages) ? params.languages : []
  const includeGlobs = Array.isArray(params?.includeGlobs) ? params.includeGlobs : []
  const excludeGlobs = Array.isArray(params?.excludeGlobs) ? params.excludeGlobs : []
  const maxMatches = params?.maxMatches
  const contextLines = params?.contextLines

  const matches = results.matches || []

  return (
    <Stack gap={12}>
      {/* Input Parameters Section */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>
          AST Pattern
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
          {pattern}
        </Code>

        <Stack gap={4} mt={6}>
          {languages.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Languages:</Text>
              <Text size="xs" c="gray.3">{languages.join(', ')}</Text>
            </Group>
          )}
          {includeGlobs.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Include:</Text>
              <Text size="xs" c="gray.3">{includeGlobs.join(', ')}</Text>
            </Group>
          )}
          {excludeGlobs.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Exclude:</Text>
              <Text size="xs" c="gray.3">{excludeGlobs.join(', ')}</Text>
            </Group>
          )}
          {maxMatches !== undefined && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Max matches:</Text>
              <Text size="xs" c="gray.3">{maxMatches}</Text>
            </Group>
          )}
          {contextLines !== undefined && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Context lines:</Text>
              <Text size="xs" c="gray.3">{contextLines}</Text>
            </Group>
          )}
        </Stack>
      </div>

      <Divider color="#3d3d3d" />

      {/* Results Section */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">
            Matches
          </Text>
          <Badge size="xs" variant="light" color="green">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </Badge>
          {results.truncated && (
            <Badge size="xs" variant="light" color="orange">
              truncated
            </Badge>
          )}
        </Group>

        {matches.length === 0 ? (
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
            {matches.slice(0, 10).map((match: any, idx: number) => (
              <Accordion.Item key={idx} value={`match-${idx}`}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text size="xs" fw={500} c="gray.3" style={{ flex: 1 }}>
                      {match.filePath}
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                      L{match.startLine}:{match.startCol}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={8}>
                    {/* Matched text */}
                    <div>
                      <Text size="xs" c="dimmed" mb={4}>Matched code:</Text>
                      <Code
                        block
                        style={{
                          fontSize: 11,
                          lineHeight: 1.4,
                          background: '#0d0d0d',
                          border: '1px solid #2d2d2d',
                          padding: 6,
                        }}
                      >
                        {match.text}
                      </Code>
                    </div>

                    {/* Context snippet */}
                    {match.snippet && match.snippet !== match.text && (
                      <div>
                        <Text size="xs" c="dimmed" mb={4}>Context:</Text>
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
                          {match.snippet}
                        </Code>
                      </div>
                    )}

                    {/* Location details */}
                    <Group gap={8}>
                      <Badge size="xs" variant="light" color="gray">
                        {match.startLine}:{match.startCol} → {match.endLine}:{match.endCol}
                      </Badge>
                    </Group>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}

        {matches.length > 10 && (
          <Text size="xs" c="dimmed" mt={8}>
            Showing first 10 of {matches.length} matches
          </Text>
        )}
      </div>

      {/* Stats Section */}
      <Group gap={8} mt={4}>
        <Text size="xs" c="dimmed">
          Scanned {results.stats?.scannedFiles ?? 0} {(Number(results.stats?.scannedFiles ?? 0) === 1) ? 'file' : 'files'}
        </Text>
        <Text size="xs" c="dimmed">
          • {Math.round(results.stats?.durationMs ?? 0)}ms
        </Text>
      </Group>
    </Stack>
  )
})

