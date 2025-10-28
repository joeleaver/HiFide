import { memo, useEffect, useCallback } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion, Button } from '@mantine/core'
import { useDispatch, useAppStore } from '../store'
import Markdown from './Markdown'

interface BadgeKnowledgeBaseSearchContentProps {
  badgeId: string
  searchKey: string
  fullParams?: any
}

export type KbHit = {
  id: string
  title: string
  tags: string[]
  files?: string[]
  path: string
  excerpt: string
  score?: number
}

export type KbSearchResult = {
  count: number
  results: KbHit[]
}

export const BadgeKnowledgeBaseSearchContent = memo(function BadgeKnowledgeBaseSearchContent({
  badgeId,
  searchKey,
  fullParams
}: BadgeKnowledgeBaseSearchContentProps) {
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

  // Prefer shallow, sanitized params stored in main store; fall back to fullParams
  const paramsFromStore = useAppStore((s) => (s as any).feToolParamsByKey?.[searchKey])

  // Read results from state (object with { count, results })
  const resultsObj: KbSearchResult | null = useAppStore((s) => (s as any).feLoadedToolResults?.[searchKey] || null)

  // Extract parameters
  const pStore: any = paramsFromStore as any
  const pFull: any = fullParams || {}

  const query: string = (typeof pStore?.query === 'string' && pStore.query) || (typeof pFull?.query === 'string' ? pFull.query : '')
  const tags: string[] = Array.isArray(pStore?.tags)
    ? (pStore.tags as any[]).map((t) => String(t))
    : (Array.isArray(pFull?.tags) ? (pFull.tags as any[]).map((t) => String(t)) : [])
  const limit: number | undefined = (typeof pStore?.limit === 'number' ? pStore.limit : (typeof pFull?.limit === 'number' ? pFull.limit : undefined))

  // KB body loading helpers
  const kbBodies = useAppStore((s) => (s as any).kbBodies || {}) as Record<string, string>
  const handleLoadBody = useCallback((id: string) => {
    dispatch('kbReadItemBody', { id })
  }, [dispatch])



  const hasObj = !!(resultsObj && typeof resultsObj === 'object')
  const results: KbHit[] = hasObj && Array.isArray((resultsObj as any).results) ? (resultsObj as any).results : []
  const totalCount: number = hasObj && typeof (resultsObj as any).count === 'number' ? (resultsObj as any).count as number : results.length

  // Auto-open and auto-load bodies for top results
  const AUTO_OPEN_TOP = 3
  const defaultOpenValues = results.slice(0, AUTO_OPEN_TOP).map((hit, idx) => `kb-${hit.id || idx}`)

  useEffect(() => {
    if (!resultsObj) return
    const idsToLoad = results.slice(0, AUTO_OPEN_TOP).map((h) => h.id).filter(Boolean)
    const state: any = (useAppStore as any).getState()
    for (const id of idsToLoad) {
      if (!state.kbBodies?.[id]) {
        dispatch('kbReadItemBody', { id })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsObj])

  return (
    <Stack gap={12}>
      {/* Input Parameters Section */}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={6}>
          Search Parameters
        </Text>
        <Stack gap={4}>
          {(query && query.trim().length > 0) && (
            <>
              <Text size="xs" c="dimmed" fw={500}>Query:</Text>
              <Code
                block
                style={{ fontSize: 11, lineHeight: 1.4, background: '#0d0d0d', border: '1px solid #2d2d2d' }}
              >
                {query}
              </Code>
            </>
          )}
          {tags.length > 0 && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Tags:</Text>
              <Group gap={4}>
                {tags.map((t, i) => (
                  <Badge key={i} size="xs" variant="light" color="indigo">{t}</Badge>
                ))}
              </Group>
            </Group>
          )}
          {typeof limit === 'number' && (
            <Group gap={6}>
              <Text size="xs" c="dimmed" fw={500}>Limit:</Text>
              <Text size="xs" c="gray.3">{limit}</Text>
            </Group>
          )}
        </Stack>
      </div>

      <Divider color="#3d3d3d" />

      {/* Results Section */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">Results</Text>
          <Badge size="xs" variant="light" color="green">
            {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
          </Badge>
        </Group>

        {results.length === 0 ? (
          <Text size="sm" c="dimmed">No matches found</Text>
        ) : (
          <Accordion
            variant="separated"
            multiple
            defaultValue={defaultOpenValues}
            styles={{
              item: { background: '#1a1a1a', border: '1px solid #2d2d2d' },
              control: { padding: '8px 12px' },
              content: { padding: '8px 12px' },
            }}
          >
            {results.slice(0, 10).map((hit, idx) => (
              <Accordion.Item key={hit.id || idx} value={`kb-${hit.id || idx}`}>
                <Accordion.Control>
                  <Group gap={8} wrap="nowrap">
                    <Text size="sm" fw={600} c="gray.2" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hit.title || hit.path}
                    </Text>
                    {typeof hit.score === 'number' && (
                      <Badge size="xs" variant="light" color="grape">{hit.score.toFixed(2)}</Badge>
                    )}
                    {Array.isArray(hit.tags) && hit.tags.slice(0, 3).map((t, i) => (
                      <Badge key={i} size="xs" variant="dot" color="blue">{t}</Badge>
                    ))}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={8}>
                    {hit.path && (
                      <Text size="xs" c="dimmed">{hit.path}</Text>
                    )}
                    {hit.excerpt && (
                      <Code
                        block
                        style={{ fontSize: 11, lineHeight: 1.4, maxHeight: 200, overflow: 'auto', background: '#0d0d0d', border: '1px solid #2d2d2d' }}
                      >
                        {hit.excerpt}
                      </Code>
                    )}

                    {/* Expansion (load full body) */}
                    <div>
                      {kbBodies[hit.id] ? (
                        <Markdown content={kbBodies[hit.id]} />
                      ) : (
                        <Button size="xs" variant="light" color="indigo" onClick={() => handleLoadBody(hit.id)}>
                          Load body
                        </Button>
                      )}
                    </div>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}

        {results.length > 10 && (
          <Text size="xs" c="dimmed" mt={8}>
            Showing first 10 of {results.length} results
          </Text>
        )}
      </div>
    </Stack>
  )
})

