import { memo, useEffect, useCallback, useState } from 'react'
import { Stack, Text, Code, Group, Badge, Divider, Accordion, Button } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'
import Markdown from './Markdown'

interface BadgeKnowledgeBaseSearchContentProps {
  badgeId: string
  searchKey?: string
  fullParams?: Record<string, unknown> | null
  llmResult?: KnowledgeBaseMinimalResult | null
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

type KnowledgeBaseMinimalResult = {
  ok?: boolean
  count?: number
  resultCount?: number
  results?: KbHit[]
  error?: string
}

const AUTO_OPEN_TOP = 3

export const BadgeKnowledgeBaseSearchContent = memo(function BadgeKnowledgeBaseSearchContent({
  badgeId,
  searchKey,
  fullParams,
  llmResult,
}: BadgeKnowledgeBaseSearchContentProps) {
  void badgeId

  // Local KB search results and bodies
  const [resultsObj, setResultsObj] = useState<KbSearchResult | null>(null)
  const [kbBodies, setKbBodies] = useState<Record<string, string>>({})
  const [uiLoading, setUiLoading] = useState<boolean>(false)
  const [uiError, setUiError] = useState<string | null>(null)

  // Load results via WS
  useEffect(() => {
    if (!searchKey) {
      setResultsObj(null)
      setUiError(null)
      setUiLoading(false)
      return
    }

    const client = getBackendClient()
    if (!client) {
      setResultsObj(null)
      setUiError('Renderer backend unavailable')
      setUiLoading(false)
      return
    }

    let cancelled = false
    setUiLoading(true)
    setUiError(null)

    client.rpc('tool.getResult', { key: searchKey }).then((res: any) => {
      if (cancelled) return
      const data = res?.result ?? res?.data ?? res
      if (data && typeof data === 'object') {
        setResultsObj(data as KbSearchResult)
      } else {
        setResultsObj(null)
      }
    }).catch((err: any) => {
      if (cancelled) return
      const message = err?.message ? String(err.message) : 'Failed to load cached preview'
      setResultsObj(null)
      setUiError(message)
    }).finally(() => {
      if (!cancelled) setUiLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [searchKey])

  // Extract parameters
  const pFull: any = fullParams || {}
  const query: string = typeof pFull?.query === 'string' ? pFull.query : ''
  const tags: string[] = Array.isArray(pFull?.tags) ? (pFull.tags as any[]).map((t) => String(t)) : []
  const limit: number | undefined = typeof pFull?.limit === 'number' ? pFull.limit : undefined

  // KB body loading helpers via WS
  const handleLoadBody = useCallback((id: string) => {
    if (!id) return
    const client = getBackendClient(); if (!client) return
    client.rpc('kb.getItemBody', { id }).then((res: any) => {
      const item = res && typeof res === 'object' ? (res as any).item : undefined
      const body = item && typeof item.body === 'string'
        ? item.body
        : typeof item?.description === 'string'
          ? item.description
          : undefined
      if (typeof body === 'string') setKbBodies((prev) => ({ ...prev, [id]: body }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!resultsObj?.results?.length) return
    const client = getBackendClient(); if (!client) return
    resultsObj.results.slice(0, AUTO_OPEN_TOP).forEach((hit) => {
      if (!hit?.id || kbBodies[hit.id]) return
      client.rpc('kb.getItemBody', { id: hit.id }).then((res: any) => {
        const item = res && typeof res === 'object' ? (res as any).item : undefined
        const body = item && typeof item.body === 'string'
          ? item.body
          : typeof item?.description === 'string'
            ? item.description
            : undefined
        if (typeof body === 'string') setKbBodies((prev) => ({ ...prev, [hit.id]: body }))
      }).catch(() => {})
    })
  }, [resultsObj, kbBodies])

  const llmHits: KbHit[] = Array.isArray(llmResult?.results) ? llmResult.results : []
  const llmCount = typeof llmResult?.count === 'number'
    ? llmResult.count
    : typeof llmResult?.resultCount === 'number'
      ? llmResult.resultCount
      : llmHits.length
  const llmRawPayload = llmResult ? JSON.stringify(llmResult, null, 2) : null

  const uiHits = Array.isArray(resultsObj?.results) ? resultsObj.results : []
  const uiCount = typeof resultsObj?.count === 'number' ? resultsObj.count : uiHits.length
  const uiRawPayload = resultsObj ? JSON.stringify(resultsObj, null, 2) : null

  const renderHits = (hits: KbHit[], prefix: string, emptyLabel: string) => {
    if (!hits.length) {
      return <Text size="sm" c="dimmed">{emptyLabel}</Text>
    }

    const defaultValues = hits.slice(0, AUTO_OPEN_TOP).map((hit, idx) => `${prefix}-${hit.id || idx}`)

    return (
      <Accordion
        variant="separated"
        multiple
        defaultValue={defaultValues}
        styles={{
          item: { background: '#1a1a1a', border: '1px solid #2d2d2d' },
          control: { padding: '8px 12px' },
          content: { padding: '8px 12px' },
        }}
      >
        {hits.map((hit, idx) => (
          <Accordion.Item key={`${prefix}-${hit.id || idx}`} value={`${prefix}-${hit.id || idx}`}>
            <Accordion.Control>
              <Group gap={8} wrap="nowrap">
                <Text size="sm" fw={600} c="gray.2" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hit.title || hit.path}
                </Text>
                {typeof hit.score === 'number' && (
                  <Badge size="xs" variant="light" color="grape">{hit.score.toFixed(2)}</Badge>
                )}
                {Array.isArray(hit.tags) && hit.tags.slice(0, 3).map((t, i) => (
                  <Badge key={`${prefix}-tag-${i}`} size="xs" variant="dot" color="blue">{t}</Badge>
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

                {hit.id && (
                  <div>
                    {kbBodies[hit.id] ? (
                      <Markdown content={kbBodies[hit.id]} />
                    ) : (
                      <Button size="xs" variant="light" color="indigo" onClick={() => handleLoadBody(hit.id)}>
                        Load body
                      </Button>
                    )}
                  </div>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    )
  }

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

      {/* Cached Preview from Renderer */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">Cached KB Preview</Text>
          {typeof uiCount === 'number' && (
            <Badge size="xs" variant="light" color="cyan">
              {uiCount} {uiCount === 1 ? 'entry' : 'entries'}
            </Badge>
          )}
          {uiLoading && (
            <Badge size="xs" variant="dot" color="yellow">loading</Badge>
          )}
        </Group>

        {uiError && (
          <Text size="sm" c="red.4">{uiError}</Text>
        )}

        {!uiError && uiLoading && (
          <Text size="sm" c="dimmed">Loading cached preview…</Text>
        )}

        {!uiError && !uiLoading && !searchKey && (
          <Text size="sm" c="dimmed">No cached preview was stored for this run.</Text>
        )}

        {!uiError && !uiLoading && searchKey && !resultsObj && (
          <Text size="sm" c="dimmed">No cached preview data is available.</Text>
        )}

        {!uiError && !uiLoading && resultsObj && (
          renderHits(uiHits, 'ui', 'No matches were stored in the renderer cache.')
        )}

        {uiRawPayload && (
          <Stack gap={4} mt={10}>
            <Text size="xs" fw={600} c="dimmed">
              Raw cached payload
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
              {uiRawPayload}
            </Code>
          </Stack>
        )}
      </div>

      {/* LLM Payload */}
      <div>
        <Group gap={8} mb={6}>
          <Text size="xs" fw={600} c="dimmed">LLM Payload</Text>
          {typeof llmCount === 'number' && (
            <Badge size="xs" variant="light" color="green">
              {llmCount} {llmCount === 1 ? 'entry' : 'entries'}
            </Badge>
          )}
        </Group>

        {!llmResult ? (
          <Text size="sm" c="dimmed">No tool payload was recorded for this call.</Text>
        ) : llmResult.error ? (
          <Text size="sm" c="red.4">{llmResult.error}</Text>
        ) : (
          renderHits(llmHits, 'llm', 'No matches were returned to the model.')
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
    </Stack>
  )
})

